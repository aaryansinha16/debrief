import type { VerdictValue } from '../../components/verdict';
import { type ClaimDraft, type ObservedDraft, type VerdictDraft, ulidOf } from './session-events';

export const CANVAS_SESSION_ID = 'session-canvas';

const at = (time: string): string => `2026-10-25T${time}.000+05:30`;

// claim-check.dc.html's seven claims as @debrief/claims extracts them (P-63), on invented systems (D-079).
export const CLAIMS: Omit<ClaimDraft, 'messageId'>[] = [
  {
    text: 'Migration 0042 is applied on staging.',
    saidAt: at('14:12:18'),
    predicate: 'migration.applied',
    subject: { system: 'tidewater', environment: 'staging' },
    params: { name: '0042' },
  },
  {
    text: 'Removed the unused feature flag.',
    saidAt: at('14:18:33'),
    predicate: 'code.removed',
    subject: { system: 'git', resource: 'src/flags.ts' },
  },
  {
    text: 'Rotated the leaked API key',
    saidAt: at('14:24:50'),
    predicate: 'secret.rotated',
    subject: { system: 'secrets' },
  },
  {
    text: 'All 142 tests pass.',
    saidAt: at('14:27:40'),
    predicate: 'tests.passed',
    subject: { system: 'forge' },
    params: { passed: 142 },
  },
  {
    text: 'I only touched the staging database.',
    saidAt: at('14:29:02'),
    predicate: 'db.scope',
    subject: { system: 'tidewater', environment: 'staging' },
    params: { environment: 'staging' },
  },
  {
    text: 'Opened PR #311 with the fix.',
    saidAt: at('14:30:11'),
    predicate: 'pr.opened',
    subject: { system: 'forge' },
    params: { number: 311 },
  },
  {
    text: 'Preview deploy is live.',
    saidAt: at('14:30:55'),
    predicate: 'deploy.ready',
    subject: { system: 'skyport' },
    params: { target: 'preview' },
  },
];

const SHA = '3e1f9c2b7d40a6158e2c9f0b4d7a31c6e85f2a90';

// Every value invented; Skyport reports after the first verdicts, so its claim's verdict is superseded.
export const OBSERVED: (ObservedDraft & { n: number })[] = [
  {
    n: 1,
    at: at('14:11:52'),
    target: {
      system: 'tidewater',
      resource: 'billing/staging',
      environment: 'staging',
      operation: 'migration.applied',
    },
    trust: 'third-party',
    summary: 'Migration 0042 applied on branch staging',
    attrs: { 'db.migration': '0042' },
  },
  {
    n: 2,
    at: at('14:18:40'),
    runId: CANVAS_SESSION_ID,
    target: {
      system: 'git',
      resource: 'acme/billing-api',
      environment: 'dev',
      operation: 'git.state',
    },
    trust: 'local',
    summary: 'acme/billing-api at 3e1f9c2 on fix/invoice-rounding: 2 files changed (+0 −17)',
    attrs: {
      'git.repo': 'acme/billing-api',
      'git.files': 2,
      'git.untracked': 0,
      'git.lines.added': 0,
      'git.lines.removed': 17,
      'git.diffstat': '0\t14\tsrc/flags.ts\n0\t3\tsrc/flags.test.ts',
      'commit.sha': SHA,
      'vcs.ref': 'refs/heads/fix/invoice-rounding',
    },
  },
  {
    n: 7,
    at: at('14:22:07'),
    target: {
      system: 'ledgerline',
      resource: 'hooks/hk-0Tq8Vx',
      environment: 'production',
      operation: 'hook.deleted',
    },
    trust: 'third-party',
    summary: 'Live webhook hk-0Tq8Vx was deleted',
    attrs: { 'ledgerline.request': 'rq-7xQ2mB', 'ledgerline.mode': 'live' },
  },
  {
    n: 4,
    at: at('14:26:31'),
    target: {
      system: 'tidewater',
      resource: 'billing/main/invoices',
      environment: 'production',
      operation: 'update',
    },
    trust: 'third-party',
    summary: 'UPDATE invoices on branch main: 1,204 rows',
    attrs: { 'db.rows': 1204, 'db.branch': 'main' },
  },
  {
    n: 3,
    at: at('14:28:55'),
    target: {
      system: 'forge',
      resource: 'acme/billing-api/pipelines/4182',
      environment: 'unknown',
      operation: 'pipeline.finished',
    },
    trust: 'third-party',
    summary: 'CI run #4182: 139 passed, 3 skipped, 0 failed',
    attrs: {
      'forge.outcome': 'passed',
      'world.tests.passed': 139,
      'world.tests.failed': 0,
      'world.tests.skipped': 3,
      'ci.tests.source': 'junit',
      'commit.sha': SHA,
    },
  },
  {
    n: 5,
    at: at('14:30:09'),
    target: {
      system: 'forge',
      resource: 'acme/billing-api#311',
      environment: 'unknown',
      operation: 'pr.opened',
    },
    trust: 'third-party',
    summary: 'PR #311 opened on acme/billing-api: 6 files',
    attrs: { 'forge.pr.number': 311, 'forge.pr.files': 6, 'commit.sha': SHA },
  },
];
export const LATE: ObservedDraft = {
  at: at('14:30:49'),
  target: {
    system: 'skyport',
    resource: 'billing-api/preview/rel-7Hq2',
    environment: 'unknown',
    operation: 'release.ready',
  },
  trust: 'third-party',
  summary: 'Preview release rel-7Hq2 ready in 41 s, answering 200',
  attrs: { 'deploy.target': 'preview', 'commit.sha': SHA },
};

const claim = (n: number): string => ulidOf('C', n);
const seen = (n: number): string => ulidOf('W', n);
const settled = at('14:31:45');

export const VERDICTS: VerdictDraft[] = [
  {
    claimId: claim(4),
    outcome: 'contradicted',
    trust: 'third-party',
    evidence: [seen(3)],
    checker: 'tests.passed@1',
    reason: 'Claimed 142 passing; the test report has 139 passed and 3 skipped.',
    at: settled,
  },
  {
    claimId: claim(5),
    outcome: 'contradicted',
    trust: 'third-party',
    evidence: [seen(4)],
    checker: 'db.scope@1',
    reason:
      'The claim leaves production out; Tidewater recorded 1,204 rows updated there during the session.',
    at: settled,
  },
  {
    claimId: claim(1),
    outcome: 'holds',
    trust: 'third-party',
    evidence: [seen(1)],
    checker: 'migration.applied@1',
    reason: 'Tidewater recorded migration 0042 applied on staging during the session.',
    at: settled,
  },
  {
    claimId: claim(6),
    outcome: 'holds',
    trust: 'third-party',
    evidence: [seen(5)],
    checker: 'pr.opened@1',
    reason: 'Forge recorded PR #311 opened from the session’s commit.',
    at: settled,
  },
  {
    claimId: claim(7),
    outcome: 'no-witness',
    checker: 'deploy.ready@1',
    reason: 'Skyport has not reported a preview release for this session yet.',
    at: settled,
  },
  {
    claimId: claim(2),
    outcome: 'holds',
    trust: 'local',
    evidence: [seen(2)],
    checker: 'code.removed@1',
    reason: 'Only the local git diff saw it: 14 lines gone from src/flags.ts.',
    at: settled,
  },
  {
    claimId: claim(3),
    outcome: 'no-witness',
    checker: 'secret.rotated@1',
    reason: 'No witness is connected for secrets; a secrets manager witness would settle it.',
    at: settled,
  },
];
export const SUPERSEDING: VerdictDraft = {
  claimId: claim(7),
  outcome: 'holds',
  trust: 'third-party',
  evidence: [seen(6)],
  checker: 'deploy.ready@1',
  reason: 'Skyport recorded the preview release ready from the session’s commit.',
  at: at('14:33:10'),
  supersedes: ulidOf('V', 5),
};

// A witnessed claim names the witness that observed it; a claim without a witness names the one that is missing.
export type CanvasClaim = { said: string; saidAt: string; world: string } & (
  | { verdict: Exclude<VerdictValue, { outcome: 'no-witness' }>; source: string }
  | { verdict: { outcome: 'no-witness' }; missing: string }
);

// The seven claims of docs/design/artboards/claim-check.dc.html with invented system names (D-079 keeps vendor
// names out of web fixtures); the feature flag is checked against the local git diff alone, so it carries local trust.
export const CANVAS_CLAIMS: readonly CanvasClaim[] = [
  {
    said: 'All 142 tests pass.',
    saidAt: '14:27:40',
    verdict: { outcome: 'contradicted', trust: 'third-party' },
    world: '139 passed. 3 were skipped.',
    source: 'Forge CI · run #4182',
  },
  {
    said: 'I only touched the staging database.',
    saidAt: '14:29:02',
    verdict: { outcome: 'contradicted', trust: 'third-party' },
    world: 'Production changed. 1,204 rows.',
    source: 'Tidewater audit log · branch main',
  },
  {
    said: 'Migration 0042 is applied on staging.',
    saidAt: '14:12:18',
    verdict: { outcome: 'holds', trust: 'third-party' },
    world: 'Present on staging.',
    source: 'Tidewater · branch staging',
  },
  {
    said: 'Opened PR #311 with the fix.',
    saidAt: '14:30:11',
    verdict: { outcome: 'holds', trust: 'third-party' },
    world: 'PR #311 open, 6 files.',
    source: 'Forge',
  },
  {
    said: 'Preview deploy is live.',
    saidAt: '14:30:55',
    verdict: { outcome: 'holds', trust: 'third-party' },
    world: 'Ready in 41 s, returns 200.',
    source: 'Skyport',
  },
  {
    said: 'Removed the unused feature flag.',
    saidAt: '14:18:33',
    verdict: { outcome: 'holds', trust: 'local' },
    world: 'Gone from src/flags.ts.',
    source: 'local git diff',
  },
  {
    said: 'Rotated the leaked API key.',
    saidAt: '14:24:50',
    verdict: { outcome: 'no-witness' },
    world: 'Nothing is watching the secrets manager.',
    missing: 'Secrets manager',
  },
];
