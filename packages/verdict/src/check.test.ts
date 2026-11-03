import type { Event } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import {
  SHA_A,
  SHA_B,
  SHA_HUMAN,
  WINDOW,
  claim,
  ev,
  gitState,
  ist,
  testReport,
  ulid,
  workflowRun,
} from './__fixtures__/index.js';
import { judge, pendingVerdicts, priorVerdicts, verdicts } from './check.js';
import { contextOf } from './select.js';

const tests = claim({
  n: 1,
  at: ist('14:27:40'),
  text: 'All 142 tests pass.',
  predicate: 'tests.passed',
  subject: { system: 'github' },
  params: { passed: 142 },
});
const base = gitState(9, ist('14:10:30'), SHA_HUMAN, []);
const git = gitState(10, ist('14:26:00'), SHA_B, [[1, 0, 'src/a.ts']]);

const verdictEvent = (
  n: number,
  claimId: string,
  patch: Record<string, string | number> = {},
): Event =>
  ev({
    n,
    at: ist('14:50:00'),
    kind: 'verdict',
    provenance: 'derived',
    attrs: {
      'verdict.claim_id': claimId,
      'verdict.outcome': 'no-witness',
      'verdict.checker': 'tests.passed@2',
      'verdict.reason': 'r',
      ...patch,
    },
  });

describe('judge', () => {
  it('never scores a hedged or unchecked claim', () => {
    const ctx = contextOf([], WINDOW);
    const hedged = claim({
      n: 1,
      at: ist('14:00:00'),
      text: 'x',
      predicate: 'tests.passed',
      subject: { system: 'github' },
      modality: 'hedged',
    });
    expect(judge(claimRecord(hedged), ctx)).toEqual({
      claimId: hedged.id,
      checker: 'tests.passed@2',
      outcome: 'no-witness',
      evidence: [],
      reason: 'hedged claim: shown, never scored',
    });
    const odd = claim({
      n: 2,
      at: ist('14:00:00'),
      text: 'x',
      predicate: 'feeling.good',
      subject: { system: 'github' },
    });
    expect(judge(claimRecord(odd), ctx)).toMatchObject({
      checker: 'unchecked@1',
      outcome: 'no-witness',
    });
  });

  it('labels a verdict third-party only when third-party evidence alone gives the same verdict', () => {
    const report = testReport({ n: 11, at: ist('14:27:21'), sha: SHA_B, runId: 1, passed: 142 });
    const local = {
      ...report,
      id: ulid(12),
      seq: 12,
      attrs: { ...report.attrs, 'witness.trust': 'local' },
    };
    const thirdParty = verdicts({ events: [tests, base, git, report], window: WINDOW })[0]!;
    expect(thirdParty).toMatchObject({
      outcome: 'holds',
      trust: 'third-party',
      evidence: [report.id],
    });
    const onlyLocal = verdicts({ events: [tests, base, git, local], window: WINDOW })[0]!;
    expect(onlyLocal).toMatchObject({ outcome: 'holds', trust: 'local', evidence: [local.id] });
    const unmarked = { ...local, attrs: { ...report.attrs, 'witness.trust': 'whatever' } };
    expect(verdicts({ events: [tests, base, git, unmarked], window: WINDOW })[0]!.trust).toBe(
      'local',
    );
    const ci = claim({
      n: 2,
      at: ist('14:27:40'),
      text: 'CI is green.',
      predicate: 'ci.passed',
      subject: { system: 'github' },
    });
    const lint = workflowRun({
      n: 13,
      at: ist('14:27:00'),
      sha: SHA_B,
      runId: 2,
      workflow: 'lint',
    });
    const build = workflowRun({
      n: 14,
      at: ist('14:27:05'),
      sha: SHA_B,
      runId: 3,
      workflow: 'build',
    });
    const localBuild = { ...build, attrs: { ...build.attrs, 'witness.trust': 'local' } };
    expect(
      verdicts({ events: [ci, base, git, lint, localBuild], window: WINDOW })[0],
    ).toMatchObject({
      outcome: 'holds',
      trust: 'local',
      evidence: [lint.id, localBuild.id],
    });
  });

  it('lowers the trust of a CI verdict when the session edited CI files or test config', () => {
    const report = testReport({ n: 11, at: ist('14:27:21'), sha: SHA_B, runId: 1, passed: 142 });
    for (const path of [
      '.github/workflows/ci.yml',
      '.github/actions/setup/action.yml',
      'vitest.config.ts',
      'vitest.workspace.ts',
      'web/jest.config.mjs',
    ]) {
      const edited = gitState(10, ist('14:26:00'), SHA_B, [[1, 0, path]]);
      const verdict = verdicts({ events: [tests, base, edited, report], window: WINDOW })[0]!;
      expect(verdict.trust, path).toBe('local');
      expect(verdict.reason).toContain(`the session edited ${path}`);
    }
    const harmless = gitState(10, ist('14:26:00'), SHA_B, [[1, 0, 'src/vitest.config.md']]);
    expect(verdicts({ events: [tests, base, harmless, report], window: WINDOW })[0]!.trust).toBe(
      'third-party',
    );
  });

  it('cuts a long reason to 280 characters and cites at most 100 events', () => {
    const states = Array.from({ length: 101 }, (_, n) =>
      gitState(
        100 + n,
        ist(
          `14:${String(20 + Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`,
        ),
        SHA_A,
        [[1, 0, `src/${'x'.repeat(40)}${String(n)}.ts`]],
      ),
    );
    const files = claim({
      n: 1,
      at: ist('14:15:00'),
      text: 'edited files',
      predicate: 'files.changed',
      subject: { system: 'git' },
    });
    const verdict = verdicts({ events: [files, ...states], window: WINDOW })[0]!;
    expect(verdict.evidence).toHaveLength(100);
    expect(verdict.reason).toHaveLength(280);
    expect(verdict.reason.endsWith('…')).toBe(true);
  });

  it('never scores a claim said before the window opens, but keeps the hedged and unchecked reasons', () => {
    const state = gitState(30, ist('14:20:00'), SHA_A, [[1, 0, 'src/flags.ts']]);
    const early = (n: number, extra: Partial<Parameters<typeof claim>[0]>) =>
      claim({
        n,
        at: ist('14:05:00'),
        text: `edited src/flags.ts (${String(n)})`,
        predicate: 'files.changed',
        subject: { system: 'git' },
        params: { path: 'src/flags.ts' },
        ...extra,
      });
    const said = verdicts({
      events: [
        early(1, {}),
        early(2, { modality: 'hedged' }),
        early(3, { predicate: 'unchecked' }),
        { ...early(4, {}), sourceTs: 'not a time' },
        state,
      ],
      window: WINDOW,
    });
    expect(said.map((v) => [v.outcome, v.reason])).toEqual([
      ['no-witness', `said before the window this check reads, which opens ${WINDOW.from}`],
      ['no-witness', 'hedged claim: shown, never scored'],
      ['no-witness', 'no checker for this sentence'],
      ['no-witness', 'said at a time this check cannot read'],
    ]);
    expect(said[0]?.evidence).toEqual([]);
  });
});

describe('prior and pending verdicts', () => {
  const run = workflowRun({ n: 11, at: ist('14:27:20'), sha: SHA_B, runId: 1 });

  it('finds the head of each claim’s supersedes chain, else the highest seq', () => {
    const first = verdictEvent(20, tests.id);
    const second = verdictEvent(21, tests.id, {
      'verdict.supersedes': first.id,
      'verdict.outcome': 'holds',
      'verdict.evidence': run.id,
      'verdict.trust': 'third-party',
    });
    const stray = verdictEvent(22, 'other');
    const loop = verdictEvent(23, 'x', { 'verdict.supersedes': ulid(24) });
    const loopBack = verdictEvent(24, 'x', { 'verdict.supersedes': ulid(23) });
    const malformed = { ...verdictEvent(25, 'y'), attrs: { 'verdict.outcome': 'holds' } };
    const prior = priorVerdicts([second, first, stray, loop, loopBack, malformed, git]);
    expect(prior.get(tests.id)).toEqual({
      id: second.id,
      outcome: 'holds',
      evidence: run.id,
      checker: 'tests.passed@2',
      trust: 'third-party',
      reason: 'r',
    });
    expect(prior.get('other')).toMatchObject({ id: stray.id, evidence: '', trust: '' });
    const reasonless = {
      ...verdictEvent(50, 'quiet'),
      attrs: { 'verdict.claim_id': 'quiet', 'verdict.outcome': 'holds', 'verdict.checker': 'x@1' },
    };
    expect(priorVerdicts([reasonless]).get('quiet')?.reason).toBe('');
    expect(prior.get('x')?.id).toBe(loopBack.id);
    expect(prior.has('y')).toBe(false);
    expect(priorVerdicts([verdictEvent(30, 'z'), verdictEvent(31, 'z')]).get('z')?.id).toBe(
      ulid(31),
    );
    expect(priorVerdicts([verdictEvent(31, 'z'), verdictEvent(30, 'z')]).get('z')?.id).toBe(
      ulid(31),
    );
  });

  it('keeps a scored verdict recorded before the window slid past its claim (D-095)', () => {
    const late = { from: '2026-10-25T09:00:00.000Z', to: WINDOW.to };
    const scored = verdictEvent(40, tests.id, {
      'verdict.outcome': 'contradicted',
      'verdict.evidence': run.id,
      'verdict.trust': 'third-party',
      'verdict.reason': 'run #1 on b7d4e90 concluded failure',
    });
    const input = { events: [tests, base, git, run, scored], window: late };
    expect(verdicts(input)).toEqual([
      {
        claimId: tests.id,
        checker: 'tests.passed@2',
        outcome: 'contradicted',
        evidence: [run.id],
        trust: 'third-party',
        reason: 'run #1 on b7d4e90 concluded failure',
      },
    ]);
    expect(pendingVerdicts(input)).toEqual([]);
    const untrusted = verdictEvent(41, tests.id, { 'verdict.outcome': 'holds' });
    expect(verdicts({ ...input, events: [tests, base, git, run, untrusted] })[0]).toEqual({
      claimId: tests.id,
      checker: 'tests.passed@2',
      outcome: 'holds',
      evidence: [],
      reason: 'r',
    });
    const unscored = verdictEvent(42, tests.id);
    expect(verdicts({ ...input, events: [tests, base, git, run, unscored] })[0]?.reason).toBe(
      `said before the window this check reads, which opens ${late.from}`,
    );
    expect(pendingVerdicts({ ...input, events: [tests, base, git, run, unscored] })).toEqual([]);
  });

  it('appends a first verdict, nothing when the record agrees, a superseding one when it changed', () => {
    const noReport = { events: [tests, base, git, run], window: WINDOW };
    const [fresh] = pendingVerdicts(noReport);
    expect(fresh?.outcome).toBe('no-witness');
    expect(fresh?.supersedes).toBeUndefined();
    const recorded = verdictEvent(20, tests.id, { 'verdict.reason': fresh!.reason });
    expect(pendingVerdicts({ ...noReport, events: [...noReport.events, recorded] })).toEqual([]);
    const report = testReport({ n: 12, at: ist('14:27:21'), sha: SHA_B, runId: 1, passed: 142 });
    const late = pendingVerdicts({ ...noReport, events: [...noReport.events, recorded, report] });
    expect(late).toEqual([
      expect.objectContaining({ outcome: 'holds', trust: 'third-party', supersedes: recorded.id }),
    ]);
  });
});

function claimRecord(event: Event) {
  const attrs = event.attrs;
  return {
    id: event.id,
    seq: event.seq,
    runId: event.runId,
    saidAt: event.sourceTs,
    text: String(attrs['claim.text']),
    modality: attrs['claim.modality'] as 'asserted' | 'hedged',
    predicate: String(attrs['claim.predicate']),
    subject: event.target ?? { system: 'unknown' },
    params: {},
  };
}
