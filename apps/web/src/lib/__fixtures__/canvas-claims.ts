import {
  type ClaimDraft,
  type Draft,
  type ObservedDraft,
  type VerdictDraft,
  claimDraft,
  observedDraft,
  stored,
  toolCallDraft,
  ulidOf,
  verdictDraft,
} from './session-events';

export const CANVAS_SESSION_ID = 'session-canvas';

const at = (time: string): string => `2026-10-25T${time}.000+05:30`;
const message = (n: number): string => `01JBCM${String(n).padStart(20, '0')}`;

// The seven claims of docs/design/artboards/claim-check.dc.html as @debrief/claims extracts them (P-63's golden),
// about the invented systems of lib/systems.ts (D-079).
const CLAIMS: Omit<ClaimDraft, 'messageId'>[] = [
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

// What each witness recorded; every value is invented. Skyport's record arrives after the first verdicts.
const OBSERVED: (ObservedDraft & { n: number })[] = [
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
      resource: 'webhook_endpoint/we_0Tq8Vx',
      environment: 'production',
      operation: 'webhook_endpoint.deleted',
    },
    trust: 'third-party',
    summary: 'Live webhook endpoint we_0Tq8Vx was deleted',
    attrs: { 'ledgerline.request_id': 'req_7xQ2mB', 'ledgerline.livemode': true },
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
      resource: 'acme/billing-api/actions/runs/4182',
      environment: 'unknown',
      operation: 'workflow_run.completed',
    },
    trust: 'third-party',
    summary: 'CI run #4182: 139 passed, 3 skipped, 0 failed',
    attrs: {
      'ci.conclusion': 'success',
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
      operation: 'pull_request.opened',
    },
    trust: 'third-party',
    summary: 'PR #311 opened on acme/billing-api: 6 files',
    attrs: { 'forge.pr.number': 311, 'forge.pr.files': 6, 'commit.sha': SHA },
  },
];
const LATE: ObservedDraft = {
  at: at('14:30:49'),
  target: {
    system: 'skyport',
    resource: 'billing-api/preview/dpl_7Hq2',
    environment: 'unknown',
    operation: 'deployment.ready',
  },
  trust: 'third-party',
  summary: 'Preview deployment dpl_7Hq2 ready in 41 s, answering 200',
  attrs: { 'deploy.target': 'preview', 'commit.sha': SHA },
};

const claim = (n: number): string => ulidOf('C', n);
const seen = (n: number): string => ulidOf('W', n);
const settled = at('14:31:45');

const VERDICTS: VerdictDraft[] = [
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
    reason: 'Skyport has not reported a preview deployment for this session yet.',
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
const SUPERSEDING: VerdictDraft = {
  claimId: claim(7),
  outcome: 'holds',
  trust: 'third-party',
  evidence: [seen(6)],
  checker: 'deploy.ready@1',
  reason: 'Skyport recorded the preview deployment ready from the session’s commit.',
  at: at('14:33:10'),
  supersedes: ulidOf('V', 5),
};

const CALL = toolCallDraft(
  ulidOf('T', 1),
  CANVAS_SESSION_ID,
  at('14:22:06'),
  'webhookEndpoints.del',
);

const witnessed = ({ n, ...draft }: ObservedDraft & { n: number }): Draft =>
  observedDraft(seen(n), draft);

// In the order the record would hold them: the session's events, then claims and verdicts once it settled.
const drafts: Draft[] = [
  ...OBSERVED.slice(0, 2).map(witnessed),
  CALL,
  ...OBSERVED.slice(2).map(witnessed),
  ...CLAIMS.map((draft, index) =>
    claimDraft(claim(index + 1), CANVAS_SESSION_ID, { ...draft, messageId: message(index + 1) }),
  ),
  ...VERDICTS.map((draft, index) => verdictDraft(ulidOf('V', index + 1), CANVAS_SESSION_ID, draft)),
  observedDraft(seen(6), LATE),
  verdictDraft(ulidOf('V', 8), CANVAS_SESSION_ID, SUPERSEDING),
];

// The canvas session as GET /v1/sessions/:id/check (P-65.1) would return it, marked as a sample.
export const CANVAS_SESSION = {
  session: {
    id: CANVAS_SESSION_ID,
    agent: 'claude-code',
    project: 'acme/billing-api',
    startedAt: at('14:02:04'),
    endedAt: at('14:31:40'),
    sample: true,
  },
  events: stored(drafts),
  sideEffects: [
    { worldEventId: seen(7), toolCallId: CALL.id, confidence: 'exact', via: 'request id' },
  ],
  witnesses: [
    { state: 'connected', system: 'forge', trust: 'third-party', observed: 11 },
    { state: 'connected', system: 'tidewater', trust: 'third-party', observed: 6 },
    { state: 'connected', system: 'skyport', trust: 'third-party', observed: 3 },
    { state: 'connected', system: 'ledgerline', trust: 'third-party', observed: 2 },
    { state: 'connected', system: 'git', trust: 'local', observed: 4 },
    { state: 'missing', system: 'secrets' },
  ],
} as const;
