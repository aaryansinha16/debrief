import { describe, expect, it } from 'vitest';

import {
  SHA_A,
  SHA_B,
  SHA_HUMAN,
  WINDOW,
  claim,
  gitState,
  ist,
  push,
  testReport,
  witness,
  workflowRun,
} from '../__fixtures__/index.js';
import { verdicts } from '../check.js';
import { contextOf } from '../select.js';
import { isRun, namedWorkflow, reportEdited, runLabel, selectCi, workflowOf } from './ci.js';

const at = ist('14:27:20');
const testsClaim = (
  params: Record<string, string | number> = { passed: 142 },
  text = 'All 142 tests pass.',
) =>
  claim({
    n: 1,
    at: ist('14:27:40'),
    text,
    predicate: 'tests.passed',
    subject: { system: 'github' },
    params,
  });
const ciClaim = (params: Record<string, string | number> = {}) =>
  claim({
    n: 2,
    at: ist('14:27:40'),
    text: 'CI is green.',
    predicate: 'ci.passed',
    subject: { system: 'github' },
    params,
  });
const base = gitState(9, ist('14:10:30'), SHA_HUMAN, []);
const git = gitState(10, ist('14:26:00'), SHA_B, []);
const one = (events: Parameters<typeof verdicts>[0]['events']) =>
  verdicts({ events, window: WINDOW })[0]!;

describe('CI selection', () => {
  it('names what is missing: runs, the git witness, a commit of the session, a run on its latest commit', () => {
    expect(one([testsClaim()]).reason).toMatch(/no GitHub Actions witness/);
    const run = workflowRun({ n: 11, at, sha: SHA_B, runId: 1 });
    expect(one([testsClaim(), run]).reason).toMatch(
      /^no local git witness recorded the working copy/,
    );
    expect(one([testsClaim(), base, run]).reason).toBe(
      "the session's HEAD stayed at c0ffee5, the commit it started from; a run on it is not the session's work",
    );
    const { 'commit.sha': _s, ...noSha } = base.attrs;
    expect(one([testsClaim(), { ...base, attrs: noSha }, run]).reason).toMatch(/HEAD stayed at ,/);
    const other = workflowRun({ n: 11, at, sha: SHA_A, runId: 1 });
    expect(one([testsClaim(), base, git, other]).reason).toBe(
      "GitHub recorded workflow runs in the window, none on this session's latest commit b7d4e90",
    );
    const older = gitState(8, ist('14:20:00'), SHA_A, []);
    expect(one([ciClaim(), base, older, git, other]).reason).toMatch(
      /none on this session's latest commit b7d4e90/,
    );
    expect(selectCi(contextOf([base, git, run], WINDOW), isRun).events.map((e) => e.seq)).toEqual([
      11,
    ]);
    expect(one([ciClaim(), push(12, at, SHA_B, 'main')]).reason).toMatch(
      /no GitHub Actions witness/,
    );
  });

  it('reads the workflow param and matches names case-insensitively', () => {
    expect(workflowOf({ params: { workflow: 'CI' } } as never)).toBe('ci');
    expect(workflowOf({ params: {} } as never)).toBeUndefined();
    const run = workflowRun({ n: 11, at, sha: SHA_B, runId: 1, workflow: 'Deploy' });
    expect(namedWorkflow(run, undefined)).toBe(true);
    expect(namedWorkflow(run, 'deploy')).toBe(true);
    expect(namedWorkflow(run, 'ci')).toBe(false);
    const nameless = witness({
      n: 12,
      at,
      target: { system: 'github', operation: 'workflow_run.completed' },
      summary: 'x',
    });
    expect(namedWorkflow(nameless, 'ci')).toBe(false);
    expect(runLabel(nameless)).toBe('run #? on ');
  });

  it('spots a session that edited the report’s workflow, anything under .github or test config', () => {
    const report = testReport({
      n: 11,
      at,
      sha: SHA_B,
      runId: 1,
      passed: 1,
      workflowPath: 'ci/custom.yml',
    });
    const edited = (path: string) =>
      reportEdited(
        [report],
        contextOf([gitState(10, ist('14:26:00'), SHA_B, [[1, 0, path]])], WINDOW),
      );
    expect(edited('ci/custom.yml')).toBe('ci/custom.yml');
    expect(edited('.github/actions/setup/action.yml')).toBe('.github/actions/setup/action.yml');
    expect(edited('pytest.ini')).toBe('pytest.ini');
    expect(edited('src/app.ts')).toBeUndefined();
    const bare = witness({
      n: 12,
      at,
      target: { system: 'github', operation: 'workflow_run.tests' },
      summary: 'x',
    });
    expect(reportEdited([bare], contextOf([], WINDOW))).toBeUndefined();
  });
});

describe('tests.passed', () => {
  it('is contradicted by failed jobs, else no-witness without a test report: job counts are not test counts', () => {
    const red = workflowRun({
      n: 11,
      at,
      sha: SHA_B,
      runId: 4182,
      conclusion: 'failure',
      jobs: { failed: 1 },
    });
    expect(one([testsClaim(), base, git, red])).toMatchObject({
      outcome: 'contradicted',
      trust: 'third-party',
      evidence: [red.id],
      reason: 'run #4182 on b7d4e90: 1 jobs failed',
    });
    const green = workflowRun({ n: 11, at, sha: SHA_B, runId: 4182 });
    expect(one([testsClaim(), base, git, green])).toMatchObject({
      outcome: 'no-witness',
      reason:
        'no test report for run #4182 on b7d4e90; job counts are not test counts (D-085), connect the CI test witness',
    });
    expect(one([testsClaim({}, 'Tests pass.'), base, git, green]).outcome).toBe('no-witness');
    const { 'ci.jobs.failed': _f, ...uncounted } = green.attrs;
    expect(one([testsClaim(), base, git, { ...green, attrs: uncounted }]).outcome).toBe(
      'no-witness',
    );
    const empty = testReport({ n: 12, at, sha: SHA_B, runId: 4182, passed: 0 });
    expect(one([testsClaim({}, 'Tests pass.'), base, git, green, empty]).reason).toBe(
      'the test report for run #4182 on b7d4e90 holds no tests',
    );
  });

  it('holds on a successful report whose counts agree with every number the claim gave', () => {
    const report = testReport({ n: 11, at, sha: SHA_B, runId: 1, passed: 139, skipped: 3 });
    expect(one([testsClaim({ passed: 139 }), base, git, report]).outcome).toBe('holds');
    expect(
      one([testsClaim({ passed: 139, skipped: 3, total: 142, failed: 0 }), base, git, report])
        .outcome,
    ).toBe('holds');
    expect(one([testsClaim({}, 'Tests pass.'), base, git, report]).outcome).toBe('holds');
    expect(one([testsClaim({ passed: 142 }), base, git, report])).toMatchObject({
      outcome: 'contradicted',
      evidence: [report.id],
      reason: 'run #1 on b7d4e90: 139 passed, 0 failed, 3 skipped; the claim says 142 passed',
    });
    expect(one([testsClaim({ total: 139 }), base, git, report]).outcome).toBe('contradicted');
  });

  it('never trusts the numbers of a sentence about failures that carries no failed count', () => {
    const report = testReport({ n: 11, at, sha: SHA_B, runId: 1, passed: 3 });
    const swapped = testsClaim({ passed: 3, total: 142 }, '3 failed out of 142.');
    expect(one([swapped, base, git, report])).toMatchObject({
      outcome: 'no-witness',
      reason:
        'the sentence speaks of failures but the claim carries no failed count, so its numbers are not trusted',
    });
    const honest = testsClaim({ passed: 139, failed: 3 }, '3 failed, 139 passed.');
    const mixed = testReport({ n: 12, at, sha: SHA_B, runId: 2, passed: 139, failed: 3 });
    expect(one([honest, base, git, mixed]).outcome).toBe('holds');
  });

  it('accepts the sum over several workflows, contradicts on failures, and needs a green conclusion', () => {
    const unit = testReport({ n: 11, at, sha: SHA_B, runId: 1, passed: 100, workflow: 'unit' });
    const e2e = testReport({ n: 12, at, sha: SHA_B, runId: 2, passed: 42, workflow: 'e2e' });
    expect(one([testsClaim(), base, git, unit, e2e])).toMatchObject({
      outcome: 'holds',
      evidence: [unit.id, e2e.id],
    });
    const broken = testReport({
      n: 13,
      at,
      sha: SHA_B,
      runId: 3,
      passed: 40,
      failed: 2,
      workflow: 'e2e',
      conclusion: 'failure',
    });
    expect(one([testsClaim(), base, git, unit, broken])).toMatchObject({
      outcome: 'contradicted',
      evidence: [broken.id],
    });
    expect(one([testsClaim({}, 'Tests pass.'), base, git, unit, broken])).toMatchObject({
      outcome: 'contradicted',
      evidence: [broken.id],
    });
    const admitted = testReport({ n: 16, at, sha: SHA_B, runId: 5, passed: 40, failed: 2 });
    expect(one([testsClaim({ passed: 40, failed: 2 }), base, git, admitted]).outcome).toBe('holds');
    expect(one([testsClaim({ passed: 41, failed: 2 }), base, git, admitted]).outcome).toBe(
      'contradicted',
    );
    const cancelled = testReport({
      n: 14,
      at,
      sha: SHA_B,
      runId: 4,
      passed: 142,
      conclusion: 'cancelled',
    });
    expect(one([testsClaim(), base, git, cancelled])).toMatchObject({
      outcome: 'no-witness',
      evidence: [cancelled.id],
      reason: 'the counts match but run #4 on b7d4e90 concluded cancelled',
    });
    const { 'ci.conclusion': _c, ...rest } = cancelled.attrs;
    expect(one([testsClaim(), base, git, { ...cancelled, attrs: rest }]).reason).toMatch(
      /concluded unknown/,
    );
  });

  it('treats two reports for one attempt that disagree as conflicting, and a retry as the only attempt', () => {
    const junit = testReport({ n: 11, at, sha: SHA_B, runId: 1, passed: 142 });
    const reporter = testReport({
      n: 12,
      at,
      sha: SHA_B,
      runId: 1,
      passed: 141,
      skipped: 1,
      source: 'reporter',
    });
    expect(one([testsClaim(), base, git, junit, reporter])).toMatchObject({
      outcome: 'no-witness',
      evidence: [junit.id, reporter.id],
      reason:
        'conflicting test counts for run #1 on b7d4e90: 142 passed, 0 failed, 0 skipped vs 141 passed, 0 failed, 1 skipped',
    });
    const same = { ...reporter, attrs: { ...junit.attrs, 'ci.tests.source': 'reporter' } };
    expect(one([testsClaim(), base, git, junit, same]).outcome).toBe('holds');
    const retry = testReport({ n: 13, at, sha: SHA_B, runId: 1, attempt: 2, passed: 142 });
    expect(one([testsClaim(), base, git, reporter, retry])).toMatchObject({
      outcome: 'holds',
      evidence: [retry.id],
    });
    const rerun = workflowRun({ n: 14, at, sha: SHA_B, runId: 1, attempt: 2 });
    expect(one([testsClaim(), base, git, reporter, rerun]).reason).toMatch(
      /^no test report for run #1/,
    );
    const countless = witness({
      n: 15,
      at,
      target: { system: 'github', operation: 'workflow_run.tests' },
      attrs: { 'commit.sha': SHA_B },
      summary: 'x',
    });
    expect(
      one([testsClaim(), base, git, countless, workflowRun({ n: 16, at, sha: SHA_B, runId: 9 })])
        .reason,
    ).toMatch(/holds no tests/);
  });
});

describe('ci.passed', () => {
  it('holds when every latest run is green and ran something, is contradicted by a failed run, waits otherwise', () => {
    const green = workflowRun({ n: 11, at, sha: SHA_B, runId: 1 });
    expect(one([ciClaim(), base, git, green])).toMatchObject({
      outcome: 'holds',
      evidence: [green.id],
      reason: 'run #1 on b7d4e90 concluded success',
    });
    const red = workflowRun({ n: 12, at, sha: SHA_B, runId: 2, conclusion: 'timed_out' });
    expect(one([ciClaim(), base, git, green, red])).toMatchObject({
      outcome: 'contradicted',
      evidence: [red.id],
    });
    const cancelled = workflowRun({ n: 13, at, sha: SHA_B, runId: 3, conclusion: 'cancelled' });
    expect(one([ciClaim(), base, git, green, cancelled])).toMatchObject({
      outcome: 'no-witness',
      evidence: [cancelled.id],
      reason: 'run #3 on b7d4e90 concluded cancelled',
    });
    const { 'ci.conclusion': _c, ...rest } = cancelled.attrs;
    expect(one([ciClaim(), base, git, { ...cancelled, attrs: rest }]).reason).toBe(
      'run #3 on b7d4e90 concluded unknown',
    );
    const skipped = workflowRun({
      n: 14,
      at,
      sha: SHA_B,
      runId: 4,
      jobs: { passed: 0, skipped: 3 },
    });
    expect(one([ciClaim(), base, git, skipped]).reason).toBe(
      'run #4 on b7d4e90 concluded success with every job skipped',
    );
    const { 'ci.jobs.passed': _p, ...unknownJobs } = green.attrs;
    expect(one([ciClaim(), base, git, { ...green, attrs: unknownJobs }]).outcome).toBe('holds');
    expect(one([ciClaim({ workflow: 'deploy' }), base, git, green, red]).reason).toMatch(
      /none on this session's latest commit/,
    );
    expect(
      one([
        ciClaim({ workflow: 'ci' }),
        base,
        git,
        green,
        { ...red, attrs: { ...red.attrs, 'github.workflow': 'deploy' } },
      ]).outcome,
    ).toBe('holds');
  });
});
