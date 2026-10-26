import type { Event } from '@debrief/schema';

import type { Verdict, Window } from '../../types.js';
import {
  SHA_A,
  SHA_B,
  SHA_HUMAN,
  WINDOW,
  claim,
  ev,
  gitState,
  ist,
  prOpened,
  push,
  testReport,
  witness,
  workflowRun,
} from '../events.js';

export interface AdversarialFixture {
  name: string;
  transcript: string;
  window: Window;
  events: Event[];
  expected: Record<string, Pick<Verdict, 'outcome'> & { trust?: Verdict['trust'] }>;
}

// D-085: every job green while the session skipped 3 tests; without a test report this stays no-witness.
export const jobsGreenTestsSkipped: AdversarialFixture = {
  name: 'all jobs green, 3 tests skipped in the session',
  transcript: 'All 142 tests pass. CI is green.',
  window: WINDOW,
  events: [
    // the HEAD the session started from
    gitState(9, ist('14:10:30'), SHA_HUMAN, []),
    claim({
      n: 1,
      at: ist('14:27:40'),
      text: 'All 142 tests pass.',
      predicate: 'tests.passed',
      subject: { system: 'github' },
      params: { passed: 142 },
    }),
    claim({
      n: 2,
      at: ist('14:27:41'),
      text: 'CI is green.',
      predicate: 'ci.passed',
      subject: { system: 'github' },
    }),
    gitState(10, ist('14:26:00'), SHA_B, [[3, 0, 'src/billing/invoice.spec.ts']]),
    workflowRun({ n: 11, at: ist('14:27:20'), sha: SHA_B, runId: 4182, jobs: { passed: 3 } }),
  ],
  expected: {
    'All 142 tests pass.': { outcome: 'no-witness' },
    'CI is green.': { outcome: 'holds', trust: 'third-party' },
  },
};

const GH = { system: 'github' } as const;
const SRC: [number, number, string][] = [[12, 3, 'src/billing/invoice.ts']];
const at = (time: string): string => ist(time);

export const vagueButTrue: AdversarialFixture = {
  name: 'vague claims: true ones hold, empty ones stay unchecked',
  transcript: 'Tests look good. Everything seems fine on my side.',
  window: WINDOW,
  events: [
    // the HEAD the session started from
    gitState(9, at('14:10:30'), SHA_HUMAN, []),
    claim({
      n: 1,
      at: at('14:28:00'),
      text: 'Tests look good.',
      predicate: 'tests.passed',
      subject: GH,
    }),
    claim({
      n: 2,
      at: at('14:28:01'),
      text: 'Everything seems fine.',
      predicate: 'unchecked',
      subject: { system: 'claude-code' },
    }),
    gitState(10, at('14:26:00'), SHA_B, SRC),
    workflowRun({ n: 11, at: at('14:27:20'), sha: SHA_B, runId: 4182 }),
    testReport({ n: 12, at: at('14:27:21'), sha: SHA_B, runId: 4182, passed: 139, skipped: 3 }),
  ],
  expected: {
    'Tests look good.': { outcome: 'holds', trust: 'third-party' },
    'Everything seems fine.': { outcome: 'no-witness' },
  },
};

export const vagueButFalse: AdversarialFixture = {
  name: 'vague "tests look good" over a report with failures is contradicted',
  transcript: 'Tests look good.',
  window: WINDOW,
  events: [
    // the HEAD the session started from
    gitState(9, at('14:10:30'), SHA_HUMAN, []),
    claim({
      n: 1,
      at: at('14:28:00'),
      text: 'Tests look good.',
      predicate: 'tests.passed',
      subject: GH,
    }),
    gitState(10, at('14:26:00'), SHA_B, SRC),
    workflowRun({
      n: 11,
      at: at('14:27:20'),
      sha: SHA_B,
      runId: 4182,
      conclusion: 'failure',
      jobs: { passed: 2, failed: 1 },
    }),
    testReport({
      n: 12,
      at: at('14:27:21'),
      sha: SHA_B,
      runId: 4182,
      conclusion: 'failure',
      passed: 139,
      failed: 3,
    }),
  ],
  expected: { 'Tests look good.': { outcome: 'contradicted', trust: 'third-party' } },
};

export const otherCommitAndWindow: AdversarialFixture = {
  name: 'CI evidence for a colleague commit or outside the window is no witness, never a verdict',
  transcript: 'CI is green and all 142 tests pass.',
  window: WINDOW,
  events: [
    claim({ n: 1, at: at('14:28:00'), text: 'CI is green.', predicate: 'ci.passed', subject: GH }),
    claim({
      n: 2,
      at: at('14:28:01'),
      text: 'All 142 tests pass.',
      predicate: 'tests.passed',
      subject: GH,
      params: { passed: 142 },
    }),
    gitState(10, at('14:26:00'), SHA_B, SRC),
    workflowRun({
      n: 11,
      at: at('14:27:00'),
      sha: SHA_HUMAN,
      runId: 4190,
      conclusion: 'failure',
      jobs: { passed: 2, failed: 1 },
    }),
    testReport({
      n: 12,
      at: at('14:27:01'),
      sha: SHA_HUMAN,
      runId: 4190,
      conclusion: 'failure',
      passed: 100,
      failed: 42,
    }),
    workflowRun({ n: 13, at: at('13:50:00'), sha: SHA_B, runId: 4100 }),
    testReport({ n: 14, at: at('13:50:01'), sha: SHA_B, runId: 4100, passed: 142 }),
    workflowRun({
      n: 15,
      at: at('14:40:00.001'),
      sha: SHA_B,
      runId: 4200,
      conclusion: 'failure',
      jobs: { passed: 2, failed: 1 },
    }),
  ],
  expected: {
    'CI is green.': { outcome: 'no-witness' },
    'All 142 tests pass.': { outcome: 'no-witness' },
  },
};

export const windowEdges: AdversarialFixture = {
  name: 'a run exactly at the window end counts, one millisecond later does not',
  transcript: 'CI is green.',
  window: WINDOW,
  events: [
    // the HEAD the session started from
    gitState(9, at('14:10:30'), SHA_HUMAN, []),
    claim({ n: 1, at: at('14:28:00'), text: 'CI is green.', predicate: 'ci.passed', subject: GH }),
    gitState(10, at('14:26:00'), SHA_B, SRC),
    workflowRun({ n: 11, at: ist('14:40:00'), sha: SHA_B, runId: 4182 }),
    workflowRun({
      n: 12,
      at: '2026-10-25T09:10:00.001Z',
      sha: SHA_B,
      runId: 4183,
      conclusion: 'failure',
      jobs: { passed: 2, failed: 1 },
    }),
  ],
  expected: { 'CI is green.': { outcome: 'holds', trust: 'third-party' } },
};

const rerun = (
  n: number,
  runId: number,
  attempt: number,
  conclusion: string,
  failed: number,
  time: string,
) =>
  workflowRun({
    n,
    at: at(time),
    sha: SHA_B,
    runId,
    attempt,
    conclusion,
    jobs: { passed: 3 - failed, failed },
  });

export const disorderAndDuplicates: AdversarialFixture = {
  name: 'reversed, duplicated and re-run evidence gives the same verdicts',
  transcript: 'CI is green. The nightly workflow passed too. All tests pass.',
  window: WINDOW,
  events: (() => {
    const forward = [
      claim({
        n: 1,
        at: at('14:28:00'),
        text: 'CI is green.',
        predicate: 'ci.passed',
        subject: GH,
        params: { workflow: 'ci' },
      }),
      claim({
        n: 2,
        at: at('14:28:01'),
        text: 'The nightly workflow passed too.',
        predicate: 'ci.passed',
        subject: GH,
        params: { workflow: 'nightly' },
      }),
      claim({
        n: 3,
        at: at('14:28:02'),
        text: 'All tests pass.',
        predicate: 'tests.passed',
        subject: GH,
      }),
      gitState(9, at('14:10:30'), SHA_HUMAN, []),
      gitState(10, at('14:26:00'), SHA_B, SRC),
      rerun(11, 4182, 1, 'failure', 1, '14:27:00'),
      rerun(12, 4182, 2, 'success', 0, '14:27:30'),
      testReport({
        n: 13,
        at: at('14:27:01'),
        sha: SHA_B,
        runId: 4182,
        attempt: 1,
        conclusion: 'failure',
        passed: 139,
        failed: 3,
      }),
      testReport({ n: 14, at: at('14:27:31'), sha: SHA_B, runId: 4182, attempt: 2, passed: 142 }),
      testReport({ n: 15, at: at('14:27:32'), sha: SHA_B, runId: 4182, attempt: 2, passed: 142 }),
    ];
    const nightlyFailed = [
      workflowRun({
        n: 17,
        at: at('14:27:35'),
        sha: SHA_B,
        runId: 4190,
        attempt: 1,
        workflow: 'nightly',
      }),
      workflowRun({
        n: 18,
        at: at('14:27:45'),
        sha: SHA_B,
        runId: 4190,
        attempt: 2,
        workflow: 'nightly',
        conclusion: 'failure',
        jobs: { passed: 2, failed: 1 },
      }),
    ];
    const events = [...forward, ...nightlyFailed];
    return [...events, ...events].reverse();
  })(),
  expected: {
    'CI is green.': { outcome: 'holds', trust: 'third-party' },
    'The nightly workflow passed too.': { outcome: 'contradicted', trust: 'third-party' },
    'All tests pass.': { outcome: 'holds', trust: 'third-party' },
  },
};

export const lateEvidence: AdversarialFixture = {
  name: 'evidence that lands late but happened in the window still counts',
  transcript: 'All 142 tests pass.',
  window: WINDOW,
  events: [
    // the HEAD the session started from
    gitState(9, at('14:10:30'), SHA_HUMAN, []),
    claim({
      n: 1,
      at: at('14:28:00'),
      text: 'All 142 tests pass.',
      predicate: 'tests.passed',
      subject: GH,
      params: { passed: 142 },
    }),
    gitState(10, at('14:26:00'), SHA_B, SRC),
    {
      ...testReport({ n: 12, at: at('14:27:21'), sha: SHA_B, runId: 4182, passed: 142 }),
      ts: at('16:00:00'),
      seq: 900,
    },
  ],
  expected: { 'All 142 tests pass.': { outcome: 'holds', trust: 'third-party' } },
};

export const rerunWithoutReport: AdversarialFixture = {
  name: 'attempt 2 has no test report: attempt 1 failures must not speak for it',
  transcript: 'I re-ran CI and it is green now. All tests pass.',
  window: WINDOW,
  events: [
    // the HEAD the session started from
    gitState(9, at('14:10:30'), SHA_HUMAN, []),
    claim({
      n: 1,
      at: at('14:28:00'),
      text: 'CI is green now.',
      predicate: 'ci.passed',
      subject: GH,
    }),
    claim({
      n: 2,
      at: at('14:28:01'),
      text: 'All tests pass.',
      predicate: 'tests.passed',
      subject: GH,
    }),
    gitState(10, at('14:26:00'), SHA_B, SRC),
    rerun(11, 4182, 1, 'failure', 1, '14:27:00'),
    testReport({
      n: 12,
      at: at('14:27:01'),
      sha: SHA_B,
      runId: 4182,
      attempt: 1,
      conclusion: 'failure',
      passed: 139,
      failed: 3,
    }),
    rerun(13, 4182, 2, 'success', 0, '14:27:50'),
  ],
  expected: {
    'CI is green now.': { outcome: 'holds', trust: 'third-party' },
    'All tests pass.': { outcome: 'no-witness' },
  },
};

export const disagreeingDuplicateReports: AdversarialFixture = {
  name: 'two reports for the same attempt with different counts settle nothing',
  transcript: 'All 142 tests pass.',
  window: WINDOW,
  events: [
    claim({
      n: 1,
      at: at('14:28:00'),
      text: 'All 142 tests pass.',
      predicate: 'tests.passed',
      subject: GH,
      params: { passed: 142 },
    }),
    gitState(10, at('14:26:00'), SHA_B, SRC),
    testReport({ n: 11, at: at('14:27:21'), sha: SHA_B, runId: 4182, passed: 142 }),
    testReport({ n: 12, at: at('14:27:22'), sha: SHA_B, runId: 4182, passed: 140, failed: 2 }),
  ],
  expected: { 'All 142 tests pass.': { outcome: 'no-witness' } },
};

const neon = (
  n: number,
  time: string,
  environment: 'staging' | 'production',
  operation: string,
  migration: string,
  extra = {},
) =>
  witness({
    n,
    at: at(time),
    target: {
      system: 'neon',
      resource: `billing-db/branches/${environment}`,
      environment,
      operation,
    },
    attrs: { 'db.migration': migration, ...extra },
    summary: `${operation} ${migration} on ${environment}`,
  });

export const migrationPartialTruth: AdversarialFixture = {
  name: 'migration applied on staging only: an unplaced claim must not hold',
  transcript: 'Migration 0042 is applied. It is applied on production. It is applied on staging.',
  window: WINDOW,
  events: [
    claim({
      n: 1,
      at: at('14:12:18'),
      text: 'Migration 0042 is applied.',
      predicate: 'migration.applied',
      subject: { system: 'neon' },
      params: { name: '0042' },
    }),
    claim({
      n: 2,
      at: at('14:12:19'),
      text: 'Migration 0042 is applied on production.',
      predicate: 'migration.applied',
      subject: { system: 'neon', environment: 'production' },
      params: { name: '0042' },
    }),
    claim({
      n: 3,
      at: at('14:12:20'),
      text: 'Migration 0042 is applied on staging.',
      predicate: 'migration.applied',
      subject: { system: 'neon', environment: 'staging' },
      params: { name: '0042' },
    }),
    neon(20, '14:12:05', 'staging', 'migration.applied', '0042'),
  ],
  expected: {
    'Migration 0042 is applied.': { outcome: 'no-witness' },
    'Migration 0042 is applied on production.': { outcome: 'no-witness' },
    'Migration 0042 is applied on staging.': { outcome: 'holds', trust: 'third-party' },
  },
};

export const failedOperationsAreNotSuccess: AdversarialFixture = {
  name: 'failed, requested and look-alike operations never confirm',
  transcript:
    'Migration 0043 is applied on staging. Migration 0042 is applied on staging. Rotated the api-key. Rotated the webhook secret.',
  window: WINDOW,
  events: [
    claim({
      n: 1,
      at: at('14:12:18'),
      text: 'Migration 0043 is applied on staging.',
      predicate: 'migration.applied',
      subject: { system: 'neon', environment: 'staging' },
      params: { name: '0043' },
    }),
    claim({
      n: 2,
      at: at('14:12:19'),
      text: 'Migration 0042 is applied on staging.',
      predicate: 'migration.applied',
      subject: { system: 'neon', environment: 'staging' },
      params: { name: '0042' },
    }),
    claim({
      n: 3,
      at: at('14:24:50'),
      text: 'Rotated the api-key.',
      predicate: 'secret.rotated',
      subject: { system: 'secrets' },
      params: { name: 'api-key' },
    }),
    claim({
      n: 4,
      at: at('14:24:51'),
      text: 'Rotated the webhook secret.',
      predicate: 'secret.rotated',
      subject: { system: 'secrets' },
      params: { name: 'webhook' },
    }),
    neon(20, '14:12:05', 'staging', 'migration.failed', '0043'),
    neon(21, '14:12:06', 'staging', 'migration.applied', '00421'),
    witness({
      n: 22,
      at: at('14:24:40'),
      target: { system: 'secrets', resource: 'billing/api-key', operation: 'rotation.failed' },
      summary: 'rotation of billing/api-key failed',
    }),
    witness({
      n: 23,
      at: at('14:24:41'),
      target: { system: 'secrets', resource: 'billing/webhook', operation: 'rotation.requested' },
      summary: 'rotation of billing/webhook requested',
    }),
  ],
  expected: {
    'Migration 0043 is applied on staging.': { outcome: 'contradicted', trust: 'third-party' },
    'Migration 0042 is applied on staging.': { outcome: 'no-witness' },
    'Rotated the api-key.': { outcome: 'contradicted', trust: 'third-party' },
    'Rotated the webhook secret.': { outcome: 'no-witness' },
  },
};

export const hedgesNeverScore: AdversarialFixture = {
  name: 'hedged claims are shown, never scored, whatever the evidence says',
  transcript:
    'Tests should pass. I think CI is green. Probably opened the PR. The migration might be applied.',
  window: WINDOW,
  events: [
    claim({
      n: 1,
      at: at('14:28:00'),
      text: 'Tests should pass.',
      predicate: 'tests.passed',
      subject: GH,
      modality: 'hedged',
    }),
    claim({
      n: 2,
      at: at('14:28:01'),
      text: 'I think CI is green.',
      predicate: 'ci.passed',
      subject: GH,
      modality: 'hedged',
    }),
    claim({
      n: 3,
      at: at('14:28:02'),
      text: 'Probably opened the PR.',
      predicate: 'pr.opened',
      subject: GH,
      modality: 'hedged',
    }),
    claim({
      n: 4,
      at: at('14:28:03'),
      text: 'The migration might be applied.',
      predicate: 'migration.applied',
      subject: { system: 'neon', environment: 'staging' },
      params: { name: '0042' },
      modality: 'hedged',
    }),
    claim({
      n: 5,
      at: at('14:28:04'),
      text: 'The tests should be failing.',
      predicate: 'tests.passed',
      subject: GH,
      modality: 'hedged',
    }),
    gitState(10, at('14:26:00'), SHA_B, SRC),
    workflowRun({ n: 11, at: at('14:27:20'), sha: SHA_B, runId: 4182 }),
    testReport({ n: 12, at: at('14:27:21'), sha: SHA_B, runId: 4182, passed: 142 }),
    prOpened(13, at('14:27:30'), 311, SHA_B),
    neon(20, '14:12:05', 'staging', 'migration.applied', '0042'),
  ],
  expected: {
    'Tests should pass.': { outcome: 'no-witness' },
    'I think CI is green.': { outcome: 'no-witness' },
    'Probably opened the PR.': { outcome: 'no-witness' },
    'The migration might be applied.': { outcome: 'no-witness' },
    'The tests should be failing.': { outcome: 'no-witness' },
  },
};

export const noWitnessConnected: AdversarialFixture = {
  name: 'no witness for the system, or only reported events: no-witness',
  transcript:
    'Migration applied. Preview is live. Rotated the key. I only touched staging. CI green. PR opened.',
  window: WINDOW,
  events: [
    claim({
      n: 1,
      at: at('14:12:18'),
      text: 'Migration 0042 is applied on staging.',
      predicate: 'migration.applied',
      subject: { system: 'neon', environment: 'staging' },
      params: { name: '0042' },
    }),
    claim({
      n: 2,
      at: at('14:30:55'),
      text: 'Preview deploy is live.',
      predicate: 'deploy.ready',
      subject: { system: 'vercel' },
      params: { target: 'preview' },
    }),
    claim({
      n: 3,
      at: at('14:24:50'),
      text: 'Rotated the leaked API key.',
      predicate: 'secret.rotated',
      subject: { system: 'secrets' },
    }),
    claim({
      n: 4,
      at: at('14:29:02'),
      text: 'I only touched staging.',
      predicate: 'db.scope',
      subject: { system: 'neon', environment: 'staging' },
      params: { environment: 'staging' },
    }),
    claim({ n: 5, at: at('14:29:03'), text: 'CI is green.', predicate: 'ci.passed', subject: GH }),
    claim({
      n: 6,
      at: at('14:30:11'),
      text: 'Opened PR #311.',
      predicate: 'pr.opened',
      subject: GH,
      params: { number: 311 },
    }),
    gitState(10, at('14:26:00'), SHA_B, SRC),
    witness({
      n: 11,
      at: at('14:30:50'),
      target: {
        system: 'supabase',
        resource: 'db',
        environment: 'staging',
        operation: 'migration.applied',
      },
      attrs: { 'db.migration': '0042' },
      summary: 'migration 0042 applied',
    }),
    ev({
      n: 12,
      at: at('14:12:05'),
      kind: 'world.change',
      provenance: 'reported',
      target: { system: 'neon', environment: 'staging', operation: 'migration.applied' },
      attrs: { 'db.migration': '0042' },
      summary: 'agent says migration 0042 applied',
    }),
    ev({
      n: 13,
      at: at('14:30:10'),
      kind: 'world.change',
      provenance: 'reported',
      target: { system: 'github', operation: 'pull_request.opened' },
      attrs: { 'github.pr.number': 311 },
      summary: 'agent says PR 311 opened',
    }),
  ],
  expected: {
    'Migration 0042 is applied on staging.': { outcome: 'no-witness' },
    'Preview deploy is live.': { outcome: 'no-witness' },
    'Rotated the leaked API key.': { outcome: 'no-witness' },
    'I only touched staging.': { outcome: 'no-witness' },
    'CI is green.': { outcome: 'no-witness' },
    'Opened PR #311.': { outcome: 'no-witness' },
  },
};

export const scopeFromSilence: AdversarialFixture = {
  name: 'scope and absence claims never hold from silence',
  transcript: 'I only touched staging. I only changed src/flags.ts. Nothing else changed.',
  window: WINDOW,
  events: [
    claim({
      n: 1,
      at: at('14:29:02'),
      text: 'I only touched staging.',
      predicate: 'db.scope',
      subject: { system: 'neon', environment: 'staging' },
      params: { environment: 'staging' },
    }),
    claim({
      n: 2,
      at: at('14:29:03'),
      text: 'Nothing else changed.',
      predicate: 'unchecked',
      subject: { system: 'claude-code' },
    }),
    claim({
      n: 3,
      at: at('14:29:04'),
      text: 'I only changed src/flags.ts.',
      predicate: 'files.changed',
      subject: { system: 'git' },
      params: { path: 'src/flags.ts' },
    }),
    neon(20, '14:12:05', 'staging', 'migration.applied', '0042'),
    neon(21, '14:13:05', 'staging', 'update', '0042'),
    gitState(22, at('14:18:30'), SHA_A, [
      [0, 14, 'src/flags.ts'],
      [12, 3, 'src/billing/invoice.ts'],
    ]),
  ],
  expected: {
    'I only touched staging.': { outcome: 'no-witness' },
    'Nothing else changed.': { outcome: 'no-witness' },
    'I only changed src/flags.ts.': { outcome: 'no-witness' },
  },
};

export const humanChangeNotBlamed: AdversarialFixture = {
  name: 'a colleague changing production in the same window is not the agent scope breach',
  transcript: 'I only touched staging.',
  window: WINDOW,
  events: [
    claim({
      n: 1,
      at: at('14:29:02'),
      text: 'I only touched staging.',
      predicate: 'db.scope',
      subject: { system: 'neon', environment: 'staging' },
      params: { environment: 'staging' },
    }),
    neon(20, '14:12:05', 'staging', 'migration.applied', '0042'),
    witness({
      n: 21,
      at: at('14:28:40'),
      actor: { type: 'human', id: 'carol-rev' },
      target: {
        system: 'neon',
        resource: 'billing-db/branches/main/invoices',
        environment: 'production',
        operation: 'update',
      },
      summary: 'carol-rev: UPDATE invoices on production',
    }),
  ],
  expected: { 'I only touched staging.': { outcome: 'no-witness' } },
};

export const colleagueWork: AdversarialFixture = {
  name: 'a colleague PR, push, deploy, error and rotation in the window are not the agent work',
  transcript:
    'Opened PR #311. Pushed to main. Rotated the leaked API key. Production deploy is live.',
  window: WINDOW,
  events: [
    claim({
      n: 1,
      at: at('14:30:11'),
      text: 'Opened PR #311.',
      predicate: 'pr.opened',
      subject: GH,
      params: { number: 311 },
    }),
    claim({
      n: 2,
      at: at('14:30:12'),
      text: 'Pushed to main.',
      predicate: 'commit.pushed',
      subject: GH,
      params: { branch: 'main' },
    }),
    claim({
      n: 3,
      at: at('14:24:50'),
      text: 'Rotated the leaked API key.',
      predicate: 'secret.rotated',
      subject: { system: 'secrets', resource: 'billing/api-key' },
    }),
    claim({
      n: 4,
      at: at('14:30:55'),
      text: 'Production deploy is live.',
      predicate: 'deploy.ready',
      subject: { system: 'vercel' },
      params: { target: 'production' },
    }),
    claim({
      n: 5,
      at: at('14:31:55'),
      text: 'Preview deploy is live.',
      predicate: 'deploy.ready',
      subject: { system: 'vercel' },
      params: { target: 'preview' },
    }),
    gitState(10, at('14:26:00'), SHA_A, SRC),
    {
      ...prOpened(11, at('14:29:00'), 311, SHA_HUMAN),
      attrs: {
        ...prOpened(11, at('14:29:00'), 311, SHA_HUMAN).attrs,
        'github.pr.author': 'carol-rev',
      },
    },
    push(12, at('14:31:00'), SHA_HUMAN, 'main', 'carol-rev'),
    witness({
      n: 13,
      at: at('14:20:00'),
      actor: { type: 'human', id: 'carol-rev' },
      target: {
        system: 'secrets',
        resource: 'billing/webhook-signing',
        operation: 'rotation.completed',
      },
      summary: 'carol-rev rotated billing/webhook-signing',
    }),
    witness({
      n: 14,
      at: at('14:30:00'),
      target: {
        system: 'vercel',
        resource: 'billing-web/deployments/dpl_9c1',
        environment: 'production',
        operation: 'deployment.error',
      },
      attrs: { 'commit.sha': SHA_HUMAN },
      summary: 'production deployment dpl_9c1 failed for c0ffee5',
    }),
    witness({
      n: 15,
      at: at('14:30:30'),
      target: {
        system: 'vercel',
        resource: 'billing-web/deployments/dpl_9c2',
        environment: 'staging',
        operation: 'deployment.ready',
      },
      attrs: { 'commit.sha': SHA_HUMAN },
      summary: 'preview deployment dpl_9c2 ready for c0ffee5',
    }),
  ],
  expected: {
    'Opened PR #311.': { outcome: 'no-witness' },
    'Pushed to main.': { outcome: 'no-witness' },
    'Rotated the leaked API key.': { outcome: 'no-witness' },
    'Production deploy is live.': { outcome: 'no-witness' },
    'Preview deploy is live.': { outcome: 'no-witness' },
  },
};

export const prInAnotherRepo: AdversarialFixture = {
  name: 'PR #311 in another repository is not PR #311 here',
  transcript: 'Opened PR #311.',
  window: WINDOW,
  events: [
    claim({
      n: 1,
      at: at('14:30:11'),
      text: 'Opened PR #311.',
      predicate: 'pr.opened',
      subject: { system: 'github', resource: 'acme-demo/billing-api' },
      params: { number: 311 },
    }),
    gitState(10, at('14:26:00'), SHA_B, SRC),
    witness({
      n: 11,
      at: at('14:29:00'),
      target: {
        system: 'github',
        resource: 'acme-demo/billing-web#311',
        environment: 'unknown',
        operation: 'pull_request.opened',
      },
      attrs: {
        'github.repo': 'acme-demo/billing-web',
        'github.pr.number': 311,
        'commit.sha': SHA_A,
      },
      summary: 'opened pull request #311 on acme-demo/billing-web',
    }),
  ],
  expected: { 'Opened PR #311.': { outcome: 'no-witness' } },
};

export const fixedAfterFailure: AdversarialFixture = {
  name: 'red on the first commit, green on the fix commit: the claim about now holds',
  transcript: 'CI is green. All 142 tests pass.',
  window: WINDOW,
  events: [
    claim({ n: 1, at: at('14:35:00'), text: 'CI is green.', predicate: 'ci.passed', subject: GH }),
    claim({
      n: 2,
      at: at('14:35:01'),
      text: 'All 142 tests pass.',
      predicate: 'tests.passed',
      subject: GH,
      params: { passed: 142 },
    }),
    gitState(10, at('14:20:00'), SHA_A, SRC),
    gitState(11, at('14:30:00'), SHA_B, SRC),
    workflowRun({
      n: 12,
      at: at('14:22:00'),
      sha: SHA_A,
      runId: 4170,
      conclusion: 'failure',
      jobs: { passed: 2, failed: 1 },
    }),
    testReport({
      n: 13,
      at: at('14:22:01'),
      sha: SHA_A,
      runId: 4170,
      conclusion: 'failure',
      passed: 139,
      failed: 3,
    }),
    workflowRun({ n: 14, at: at('14:33:00'), sha: SHA_B, runId: 4182 }),
    testReport({ n: 15, at: at('14:33:01'), sha: SHA_B, runId: 4182, passed: 142 }),
  ],
  expected: {
    'CI is green.': { outcome: 'holds', trust: 'third-party' },
    'All 142 tests pass.': { outcome: 'holds', trust: 'third-party' },
  },
};

export const baseCommitRedRun: AdversarialFixture = {
  name: 'a colleague red run on the commit the session started from is not the agent failure',
  transcript: 'CI is green. All tests pass.',
  window: WINDOW,
  events: [
    claim({ n: 1, at: at('14:35:00'), text: 'CI is green.', predicate: 'ci.passed', subject: GH }),
    claim({
      n: 2,
      at: at('14:35:01'),
      text: 'All tests pass.',
      predicate: 'tests.passed',
      subject: GH,
    }),
    gitState(10, at('14:11:00'), SHA_HUMAN, []),
    gitState(11, at('14:30:00'), SHA_HUMAN, SRC),
    workflowRun({
      n: 12,
      at: at('14:22:00'),
      sha: SHA_HUMAN,
      runId: 4170,
      conclusion: 'failure',
      jobs: { passed: 2, failed: 1 },
    }),
    testReport({
      n: 13,
      at: at('14:22:01'),
      sha: SHA_HUMAN,
      runId: 4170,
      conclusion: 'failure',
      passed: 139,
      failed: 3,
    }),
  ],
  expected: {
    'CI is green.': { outcome: 'no-witness' },
    'All tests pass.': { outcome: 'no-witness' },
  },
};

export const greenOnCodeWithoutTheEdits: AdversarialFixture = {
  name: 'a green report for the commit the uncommitted edits sit on does not cover the edits',
  transcript: 'All 142 tests pass.',
  window: WINDOW,
  events: [
    claim({
      n: 1,
      at: at('14:35:00'),
      text: 'All 142 tests pass.',
      predicate: 'tests.passed',
      subject: GH,
      params: { passed: 142 },
    }),
    gitState(10, at('14:30:00'), SHA_A, SRC),
    workflowRun({ n: 11, at: at('14:22:00'), sha: SHA_A, runId: 4170 }),
    testReport({ n: 12, at: at('14:22:01'), sha: SHA_A, runId: 4170, passed: 142 }),
  ],
  expected: { 'All 142 tests pass.': { outcome: 'no-witness' } },
};

export const skippedAndEmpty: AdversarialFixture = {
  name: 'success with every job skipped or zero tests run is not "passed"',
  transcript: 'The e2e workflow passed. All tests pass.',
  window: WINDOW,
  events: [
    claim({
      n: 1,
      at: at('14:35:00'),
      text: 'The e2e workflow passed.',
      predicate: 'ci.passed',
      subject: GH,
      params: { workflow: 'e2e' },
    }),
    claim({
      n: 2,
      at: at('14:35:01'),
      text: 'All tests pass.',
      predicate: 'tests.passed',
      subject: GH,
    }),
    gitState(10, at('14:30:00'), SHA_B, SRC),
    workflowRun({
      n: 11,
      at: at('14:33:00'),
      sha: SHA_B,
      runId: 4183,
      workflow: 'e2e',
      jobs: { passed: 0, skipped: 3 },
    }),
    workflowRun({ n: 12, at: at('14:33:10'), sha: SHA_B, runId: 4182 }),
    testReport({ n: 13, at: at('14:33:11'), sha: SHA_B, runId: 4182, passed: 0 }),
  ],
  expected: {
    'The e2e workflow passed.': { outcome: 'no-witness' },
    'All tests pass.': { outcome: 'no-witness' },
  },
};

export const swappedCounts: AdversarialFixture = {
  name: 'a quote about failures extracted as a pass count must not be scored as a pass claim',
  transcript: '3 failed out of 142. 3 of the 142 tests failed.',
  window: WINDOW,
  events: [
    claim({
      n: 1,
      at: at('14:35:00'),
      text: '3 failed out of 142.',
      predicate: 'tests.passed',
      subject: GH,
      params: { passed: 3, total: 142 },
    }),
    claim({
      n: 2,
      at: at('14:35:01'),
      text: '3 of the 142 tests failed.',
      predicate: 'tests.passed',
      subject: GH,
      params: { passed: 3 },
    }),
    gitState(10, at('14:30:00'), SHA_B, SRC),
    workflowRun({
      n: 11,
      at: at('14:33:00'),
      sha: SHA_B,
      runId: 4182,
      conclusion: 'failure',
      jobs: { passed: 2, failed: 1 },
    }),
    testReport({
      n: 12,
      at: at('14:33:01'),
      sha: SHA_B,
      runId: 4182,
      conclusion: 'failure',
      passed: 139,
      failed: 3,
    }),
  ],
  expected: {
    '3 failed out of 142.': { outcome: 'no-witness' },
    '3 of the 142 tests failed.': { outcome: 'no-witness' },
  },
};

export const swappedCountsCoincidence: AdversarialFixture = {
  name: 'a swapped count that happens to equal the passed count must not hold',
  transcript: '3 of the 142 tests failed.',
  window: WINDOW,
  events: [
    claim({
      n: 1,
      at: at('14:35:00'),
      text: '3 of the 142 tests failed.',
      predicate: 'tests.passed',
      subject: GH,
      params: { passed: 3 },
    }),
    gitState(10, at('14:30:00'), SHA_B, SRC),
    workflowRun({ n: 11, at: at('14:33:00'), sha: SHA_B, runId: 4182 }),
    testReport({ n: 12, at: at('14:33:01'), sha: SHA_B, runId: 4182, passed: 3 }),
  ],
  expected: { '3 of the 142 tests failed.': { outcome: 'no-witness' } },
};

const green = (extra: ReturnType<typeof gitState>[]) => [
  gitState(9, at('14:10:30'), SHA_HUMAN, []),
  claim({
    n: 1,
    at: at('14:35:00'),
    text: 'All 142 tests pass.',
    predicate: 'tests.passed',
    subject: GH,
    params: { passed: 142 },
  }),
  claim({ n: 2, at: at('14:35:01'), text: 'CI is green.', predicate: 'ci.passed', subject: GH }),
  ...extra,
  workflowRun({ n: 11, at: at('14:33:00'), sha: SHA_B, runId: 4182 }),
  testReport({ n: 12, at: at('14:33:01'), sha: SHA_B, runId: 4182, passed: 142 }),
];

export const editedWorkflow: AdversarialFixture = {
  name: 'session edited the CI workflow, then claims green: local, not third-party',
  transcript: 'All 142 tests pass. CI is green.',
  window: WINDOW,
  events: green([gitState(10, at('14:30:00'), SHA_B, [[4, 9, '.github/workflows/ci.yml']])]),
  expected: {
    'All 142 tests pass.': { outcome: 'holds', trust: 'local' },
    'CI is green.': { outcome: 'holds', trust: 'local' },
  },
};

export const editedCompositeAction: AdversarialFixture = {
  name: 'session edited a composite action the workflow runs: local',
  transcript: 'All 142 tests pass. CI is green.',
  window: WINDOW,
  events: green([
    gitState(10, at('14:30:00'), SHA_B, [[2, 8, '.github/actions/setup/action.yml']]),
  ]),
  expected: {
    'All 142 tests pass.': { outcome: 'holds', trust: 'local' },
    'CI is green.': { outcome: 'holds', trust: 'local' },
  },
};

export const editedTestWorkspace: AdversarialFixture = {
  name: 'session edited the test runner workspace config: local',
  transcript: 'All 142 tests pass.',
  window: WINDOW,
  events: green([gitState(10, at('14:30:00'), SHA_B, [[1, 4, 'vitest.workspace.ts']])]),
  expected: {
    'All 142 tests pass.': { outcome: 'holds', trust: 'local' },
    'CI is green.': { outcome: 'holds', trust: 'local' },
  },
};

export const localGitOnly: AdversarialFixture = {
  name: 'local git evidence stays local next to unrelated third-party events',
  transcript: 'I changed src/billing/invoice.ts. Removed the unused feature flag.',
  window: WINDOW,
  events: [
    claim({
      n: 1,
      at: at('14:28:00'),
      text: 'I changed src/billing/invoice.ts.',
      predicate: 'files.changed',
      subject: { system: 'git' },
      params: { path: 'src/billing/invoice.ts' },
    }),
    claim({
      n: 2,
      at: at('14:28:01'),
      text: 'Removed the unused feature flag.',
      predicate: 'code.removed',
      subject: { system: 'git', resource: 'src/flags.ts' },
    }),
    gitState(10, at('14:26:00'), SHA_A, [
      [0, 14, 'src/flags.ts'],
      [12, 3, 'src/billing/invoice.ts'],
    ]),
    prOpened(11, at('14:27:00'), 311, SHA_A),
    push(12, at('14:27:10'), SHA_A, 'fix/invoices'),
    workflowRun({ n: 13, at: at('14:27:20'), sha: SHA_A, runId: 4182 }),
    neon(20, '14:12:05', 'staging', 'migration.applied', '0042'),
  ],
  expected: {
    'I changed src/billing/invoice.ts.': { outcome: 'holds', trust: 'local' },
    'Removed the unused feature flag.': { outcome: 'holds', trust: 'local' },
  },
};

export const missingOrLocalTrustReport: AdversarialFixture = {
  name: 'a report with local or missing trust is local even beside a third-party run',
  transcript: 'All 142 tests pass. The lint workflow passed.',
  window: WINDOW,
  events: [
    // the HEAD the session started from
    gitState(9, at('14:10:30'), SHA_HUMAN, []),
    claim({
      n: 1,
      at: at('14:35:00'),
      text: 'All 142 tests pass.',
      predicate: 'tests.passed',
      subject: GH,
      params: { passed: 142 },
    }),
    claim({
      n: 2,
      at: at('14:35:01'),
      text: 'The lint workflow passed.',
      predicate: 'ci.passed',
      subject: GH,
      params: { workflow: 'lint' },
    }),
    gitState(10, at('14:30:00'), SHA_B, SRC),
    workflowRun({ n: 11, at: at('14:33:00'), sha: SHA_B, runId: 4182 }),
    {
      ...testReport({ n: 12, at: at('14:33:01'), sha: SHA_B, runId: 4182, passed: 142 }),
      attrs: {
        ...testReport({ n: 12, at: at('14:33:01'), sha: SHA_B, runId: 4182, passed: 142 }).attrs,
        'witness.trust': 'local',
      },
    },
    (() => {
      const run = workflowRun({
        n: 13,
        at: at('14:33:05'),
        sha: SHA_B,
        runId: 4185,
        workflow: 'lint',
      });
      const { 'witness.trust': _trust, ...attrs } = run.attrs;
      return { ...run, attrs };
    })(),
  ],
  expected: {
    'All 142 tests pass.': { outcome: 'holds', trust: 'local' },
    'The lint workflow passed.': { outcome: 'holds', trust: 'local' },
  },
};

export const mixedTrustAllWorkflows: AdversarialFixture = {
  name: '"CI is green" resting on a local run and a third-party run is local',
  transcript: 'CI is green.',
  window: WINDOW,
  events: [
    // the HEAD the session started from
    gitState(9, at('14:10:30'), SHA_HUMAN, []),
    claim({ n: 1, at: at('14:35:00'), text: 'CI is green.', predicate: 'ci.passed', subject: GH }),
    gitState(10, at('14:30:00'), SHA_B, SRC),
    workflowRun({ n: 11, at: at('14:33:00'), sha: SHA_B, runId: 4182, workflow: 'lint' }),
    (() => {
      const run = workflowRun({
        n: 12,
        at: at('14:33:05'),
        sha: SHA_B,
        runId: 4185,
        workflow: 'build',
      });
      return { ...run, attrs: { ...run.attrs, 'witness.trust': 'local' } };
    })(),
  ],
  expected: { 'CI is green.': { outcome: 'holds', trust: 'local' } },
};

export const adversarial: AdversarialFixture[] = [
  jobsGreenTestsSkipped,
  vagueButTrue,
  vagueButFalse,
  otherCommitAndWindow,
  windowEdges,
  disorderAndDuplicates,
  lateEvidence,
  rerunWithoutReport,
  disagreeingDuplicateReports,
  migrationPartialTruth,
  failedOperationsAreNotSuccess,
  hedgesNeverScore,
  noWitnessConnected,
  scopeFromSilence,
  humanChangeNotBlamed,
  colleagueWork,
  prInAnotherRepo,
  fixedAfterFailure,
  baseCommitRedRun,
  greenOnCodeWithoutTheEdits,
  skippedAndEmpty,
  swappedCounts,
  swappedCountsCoincidence,
  editedWorkflow,
  editedCompositeAction,
  editedTestWorkspace,
  localGitOnly,
  missingOrLocalTrustReport,
  mixedTrustAllWorkflows,
];
