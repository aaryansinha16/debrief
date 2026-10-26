import type { Event } from '@debrief/schema';

import type { CheckInput } from '../types.js';
import {
  SHA_A,
  SHA_B,
  SHA_HUMAN,
  WINDOW,
  claim,
  gitState,
  ist,
  prOpened,
  push,
  testReport,
  witness,
  workflowRun,
} from './events.js';

export * from './events.js';

// The canvas session (docs/design/artboards/claim-check.dc.html) as events; values invented (D-079).
export const canvasClaims: Event[] = [
  claim({
    n: 1,
    at: ist('14:12:18'),
    text: 'Migration 0042 is applied on staging.',
    predicate: 'migration.applied',
    subject: { system: 'neon', environment: 'staging' },
    params: { name: '0042' },
  }),
  claim({
    n: 2,
    at: ist('14:18:33'),
    text: 'Removed the unused feature flag.',
    predicate: 'code.removed',
    subject: { system: 'git', resource: 'src/flags.ts' },
  }),
  claim({
    n: 3,
    at: ist('14:24:50'),
    text: 'Rotated the leaked API key',
    predicate: 'secret.rotated',
    subject: { system: 'secrets' },
  }),
  claim({
    n: 4,
    at: ist('14:27:40'),
    text: 'All 142 tests pass.',
    predicate: 'tests.passed',
    subject: { system: 'github' },
    params: { passed: 142 },
  }),
  claim({
    n: 5,
    at: ist('14:29:02'),
    text: 'I only touched the staging database.',
    predicate: 'db.scope',
    subject: { system: 'neon', environment: 'staging' },
    params: { environment: 'staging' },
  }),
  claim({
    n: 6,
    at: ist('14:30:11'),
    text: 'Opened PR #311 with the fix.',
    predicate: 'pr.opened',
    subject: { system: 'github', resource: 'acme/billing-api' },
    params: { number: 311 },
  }),
  claim({
    n: 7,
    at: ist('14:30:55'),
    text: 'Preview deploy is live.',
    predicate: 'deploy.ready',
    subject: { system: 'vercel' },
    params: { target: 'preview' },
  }),
  claim({
    n: 8,
    at: ist('14:30:55'),
    text: 'The build should stay green, I think.',
    predicate: 'ci.passed',
    subject: { system: 'github' },
    modality: 'hedged',
  }),
  claim({
    n: 9,
    at: ist('14:31:10'),
    text: 'ship it',
    predicate: 'unchecked',
    subject: { system: 'claude-code' },
  }),
];

export const canvasWitnesses: Event[] = [
  gitState(20, ist('14:11:00'), SHA_A, []),
  witness({
    n: 21,
    at: ist('14:12:05'),
    target: {
      system: 'neon',
      resource: 'billing-db/branches/staging',
      environment: 'staging',
      operation: 'migration.applied',
    },
    attrs: { 'db.migration': '0042', 'db.schema_hash': 'f3a9c1' },
    summary: 'migration 0042 applied on branch staging (schema f3a9c1)',
  }),
  gitState(22, ist('14:18:30'), SHA_A, [
    [0, 14, 'src/flags.ts'],
    [12, 3, 'src/billing/invoice.ts'],
    [9, 0, 'src/billing/invoice.spec.ts'],
  ]),
  gitState(23, ist('14:26:00'), SHA_B, [], 'fix/invoices'),
  push(24, ist('14:26:10'), SHA_B, 'fix/invoices'),
  workflowRun({ n: 25, at: ist('14:27:20'), sha: SHA_B, runId: 4182 }),
  testReport({ n: 26, at: ist('14:27:21'), sha: SHA_B, runId: 4182, passed: 139, skipped: 3 }),
  witness({
    n: 27,
    at: ist('14:28:40'),
    target: {
      system: 'neon',
      resource: 'billing-db/branches/main/invoices',
      environment: 'production',
      operation: 'update',
    },
    actor: { type: 'system', id: 'app-user' },
    attrs: { 'world.rows': 1204, 'db.txid': 88214 },
    summary: 'UPDATE invoices on branch main: 1204 rows',
  }),
  prOpened(28, ist('14:30:05'), 311, SHA_B),
  witness({
    n: 29,
    at: ist('14:30:50'),
    target: {
      system: 'vercel',
      resource: 'billing-web/deployments/dpl_7f3a',
      environment: 'staging',
      operation: 'deployment.ready',
    },
    attrs: { 'commit.sha': SHA_B, 'deploy.id': 'dpl_7f3a', 'deploy.duration_ms': 41_000 },
    summary: 'preview deployment dpl_7f3a ready in 41 s for b7d4e90',
  }),
  push(30, ist('14:31:00'), SHA_HUMAN, 'main', 'carol-rev'),
  witness({
    n: 31,
    at: ist('14:45:00'),
    target: {
      system: 'neon',
      resource: 'billing-db/branches/main/invoices',
      environment: 'production',
      operation: 'update',
    },
    attrs: { 'world.rows': 1 },
    summary: 'UPDATE invoices on branch main: 1 row (after the window)',
  }),
];

export const canvasCheck: CheckInput = {
  events: [...canvasClaims, ...canvasWitnesses],
  window: WINDOW,
};
