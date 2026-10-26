import {
  type CheckRun,
  checkRunSchema,
  workflowRunSchema,
  type WorkflowRun,
} from '@debrief/witness-github';
import { JUNIT_FILES, rest } from '@debrief/witness-github/fixtures';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import type { Artifact, GithubClient } from './github-api.js';
import { readRunTests, REPORT_LIMITS } from './reports.js';

const REPO = 'acme-demo/widgets';
const run: WorkflowRun = workflowRunSchema.parse(rest.runs[0]);
const reporter = checkRunSchema.parse(rest.checkRunsBySha[run.head_sha]?.check_runs[0]);

const zipOf = (files: Record<string, string>): Uint8Array =>
  zipSync(Object.fromEntries(Object.entries(files).map(([name, xml]) => [name, strToU8(xml)])), {
    level: 0,
  });

// One stored entry that `entries` directory records point at, each declaring `declared` bytes.
function storedZip(payload: Uint8Array, entries: number, declared: number): Uint8Array {
  const local = Buffer.alloc(30 + 5);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(declared, 22);
  local.writeUInt16LE(5, 26);
  local.write('a.xml', 30);
  const directory = Array.from({ length: entries }, (_, i) => {
    const name = `f${String(i)}.xml`;
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt32LE(payload.length, 20);
    record.writeUInt32LE(declared, 24);
    record.writeUInt16LE(name.length, 28);
    return Buffer.concat([record, Buffer.from(name)]);
  });
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries, 8);
  end.writeUInt16LE(entries, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + payload.length, 16);
  return Buffer.concat([local, payload, central, end]);
}

const artifact = (id: number, name = 'junit-reports', size = 100): Artifact => ({
  id,
  name,
  size_in_bytes: size,
  expired: false,
  created_at: '2026-10-20T10:10:00Z',
});

function setup(options: {
  artifacts?: Artifact[];
  zips?: Record<number, Uint8Array>;
  checks?: CheckRun[];
  run?: WorkflowRun;
}) {
  const downloads: number[] = [];
  const client = {
    artifacts: () => Promise.resolve(options.artifacts ?? []),
    artifactZip: (_repo: string, id: number) => {
      downloads.push(id);
      return Promise.resolve(options.zips?.[id] ?? new Uint8Array());
    },
    checkRuns: () => Promise.resolve(options.checks ?? []),
  } as unknown as GithubClient;
  const logged: string[] = [];
  const read = () =>
    readRunTests(client, REPO, options.run ?? run, (message) => logged.push(message));
  return { read, logged, downloads };
}

const counts = (events: { attrs: Record<string, unknown> }[]) => [
  events[0]?.attrs['world.tests.passed'],
  events[0]?.attrs['world.tests.failed'],
  events[0]?.attrs['world.tests.skipped'],
];

describe('readRunTests', () => {
  it('counts several JUnit files in an artifact exactly, an error as a failure', async () => {
    const { read, logged } = setup({
      artifacts: [artifact(1)],
      zips: {
        1: zipOf({
          'reports/api.xml': JUNIT_FILES['api.xml'] ?? '',
          'web.xml': JUNIT_FILES['web.xml'] ?? '',
          'core.xml': JUNIT_FILES['core.xml'] ?? '',
          'notes.txt': 'x',
        }),
      },
    });
    const { events, found } = await read();
    expect(found).toBe(true);
    expect(counts(events)).toEqual([15, 2, 2]);
    expect(events[0]?.attrs['ci.tests.source']).toBe('junit');
    expect(logged).toEqual([]);
  });

  it('reads the reporter check run as the same counts, and ignores unrelated checks', async () => {
    const other = { ...reporter, id: 2, check_suite: { id: 9999 } };
    const plain = { ...reporter, id: 3, output: null };
    const { read } = setup({ checks: [other, plain, reporter] });
    const { events } = await read();
    expect(counts(events)).toEqual([15, 2, 2]);
    expect(events[0]?.attrs['ci.tests.source']).toBe('check-run');
  });

  it('matches a reporter by sha when the run names no suite', async () => {
    const bare = { ...run, check_suite_id: undefined };
    const client = {
      artifacts: () => Promise.resolve([]),
      checkRuns: () => Promise.resolve([{ ...reporter, check_suite: null }]),
    } as unknown as GithubClient;
    const { events } = await readRunTests(client, REPO, bare, () => undefined);
    expect(counts(events)).toEqual([15, 2, 2]);
  });

  it('carries no counts for a run without a report', async () => {
    const { read, logged, downloads } = setup({
      artifacts: [{ ...artifact(1), expired: true }, artifact(2, 'build-output')],
    });
    expect(await read()).toEqual({ events: [], found: false });
    expect(downloads).toEqual([]);
    expect(logged).toEqual([]);
  });

  it('posts no counts, and says why, when two sources disagree', async () => {
    const { read, logged } = setup({
      artifacts: [artifact(1)],
      zips: { 1: zipOf({ 'web.xml': JUNIT_FILES['web.xml'] ?? '' }) },
      checks: [reporter],
    });
    expect(await read()).toEqual({ events: [], found: true });
    expect(logged[0]).toContain('junit says 4/1/0 and publish-unit-test-result says 15/2/2');
  });

  it.each([
    ['malformed XML', () => zipOf({ 'a.xml': '<testsuite><testcase>' }), /malformed JUnit/],
    ['no tests', () => zipOf({ 'a.xml': '<testsuite/>' }), /holds no tests/],
    ['an unreadable zip', () => strToU8('not a zip'), /not a readable zip/],
    [
      'an oversized file',
      () => zipOf({ 'a.xml': `<testsuite>${' '.repeat(REPORT_LIMITS.xmlBytes)}</testsuite>` }),
      /exceed the limits/,
    ],
    [
      'too many files',
      () =>
        zipOf(
          Object.fromEntries(
            Array.from({ length: REPORT_LIMITS.files + 1 }, (_, i) => [
              `f${String(i)}.xml`,
              '<testsuite/>',
            ]),
          ),
        ),
      /exceed the limits/,
    ],
    [
      'too many bytes in total',
      () => {
        const body = strToU8(`<testsuite>${' '.repeat(REPORT_LIMITS.xmlBytes - 1000)}</testsuite>`);
        const files = Array.from({ length: 6 }, (_, i) => [`f${String(i)}.xml`, body] as const);
        return zipSync(Object.fromEntries(files), { level: 0 });
      },
      /exceed the limits/,
    ],
  ])('posts no counts for %s and logs why', async (_name, build, why) => {
    const { read, logged } = setup({ artifacts: [artifact(1)], zips: { 1: build() } });
    expect(await read()).toEqual({ events: [], found: true });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(why);
    expect(logged[0]).toContain(`${REPO} run 7002`);
  });

  it('refuses artifacts that are too many or too big before downloading', async () => {
    const many = setup({
      artifacts: Array.from({ length: REPORT_LIMITS.artifacts + 1 }, (_, i) => artifact(i)),
    });
    expect(await many.read()).toEqual({ events: [], found: true });
    expect(many.logged[0]).toContain('JUnit artifacts, limit is 10');
    const big = setup({ artifacts: [artifact(1, 'junit', REPORT_LIMITS.zipBytes + 1)] });
    expect((await big.read()).events).toEqual([]);
    expect(big.logged[0]).toContain('bytes');
    expect([...many.downloads, ...big.downloads]).toEqual([]);
  });

  it('lets other failures through so the poller retries', async () => {
    const client = {
      artifacts: () => Promise.reject(new Error('boom')),
    } as unknown as GithubClient;
    await expect(readRunTests(client, REPO, run, () => undefined)).rejects.toThrow('boom');
  });

  it('names the file when an unrelated xml sits in a junit artifact', async () => {
    const { read, logged } = setup({
      artifacts: [artifact(1)],
      zips: { 1: zipOf({ 'junit.xml': JUNIT_FILES['web.xml'] ?? '', 'sitemap.xml': '<urlset/>' }) },
    });
    expect((await read()).events).toEqual([]);
    expect(logged[0]).toContain('sitemap.xml: malformed JUnit: unexpected root <urlset>');
  });

  it('refuses stored entries that understate their size and read past the caps', async () => {
    const body = strToU8(`<testsuite>${' '.repeat(REPORT_LIMITS.xmlBytes)}</testsuite>`);
    const { read, logged } = setup({
      artifacts: [artifact(1)],
      zips: { 1: storedZip(body, 3, 1) },
    });
    expect((await read()).events).toEqual([]);
    expect(logged[0]).toContain('exceed the limits');
    const small = strToU8('<testsuite/>');
    const lying = setup({ artifacts: [artifact(1)], zips: { 1: storedZip(small, 1, 1) } });
    expect((await lying.read()).events).toEqual([]);
    expect(lying.logged[0]).toContain('exceed the limits');
  });

  it('posts no JUnit counts from an artifact that predates this attempt', async () => {
    const older = { ...artifact(1), created_at: '2026-10-20T09:00:00Z' };
    const early = setup({
      artifacts: [older],
      zips: { 1: zipOf({ 'a.xml': JUNIT_FILES['web.xml'] ?? '' }) },
    });
    expect((await early.read()).events).toEqual([]);
    expect(early.logged[0]).toContain('does not belong to attempt 2');
    const undated = { ...artifact(1), created_at: null };
    const blind = setup({ artifacts: [undated], zips: { 1: zipOf({ 'a.xml': '<testsuite/>' }) } });
    expect((await blind.read()).events).toEqual([]);
    expect(blind.logged[0]).toContain('does not belong');
    const first = setup({
      artifacts: [undated],
      zips: { 1: zipOf({ 'a.xml': JUNIT_FILES['web.xml'] ?? '' }) },
      run: { ...run, run_attempt: 1 },
    });
    expect(counts((await first.read()).events)).toEqual([4, 1, 0]);
  });

  it('cannot tell a re-run from its first attempt without run_started_at', async () => {
    const { read, logged } = setup({ run: { ...run, run_started_at: null } });
    expect(await read()).toEqual({ events: [], found: true });
    expect(logged[0]).toContain('without run_started_at');
  });

  it('skips reporter check runs that finished before this attempt began', async () => {
    const stale = { ...reporter, completed_at: '2026-10-20T09:00:00Z' };
    const { read } = setup({ checks: [stale] });
    expect(await read()).toEqual({ events: [], found: false });
    const unfinished = setup({ checks: [{ ...reporter, completed_at: null }] });
    expect(counts((await unfinished.read()).events)).toEqual([15, 2, 2]);
  });
});
