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

const artifact = (id: number, name = 'junit-reports', size = 100): Artifact => ({
  id,
  name,
  size_in_bytes: size,
  expired: false,
});

function setup(options: {
  artifacts?: Artifact[];
  zips?: Record<number, Uint8Array>;
  checks?: CheckRun[];
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
  const read = () => readRunTests(client, REPO, run, (message) => logged.push(message));
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
    expect(logged[0]).toContain('junit says 4/1/0 and check-run says 15/2/2');
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
      () =>
        zipOf(
          Object.fromEntries(
            Array.from({ length: 6 }, (_, i) => [
              `f${String(i)}.xml`,
              `<testsuite>${' '.repeat(REPORT_LIMITS.xmlBytes - 1000)}</testsuite>`,
            ]),
          ),
        ),
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
});
