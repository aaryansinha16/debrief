import type { Event } from '@debrief/schema';

import type { Window } from '../types.js';
import { SHA_B, claim, ev, gitState, ist, prOpened, witness } from './events.js';

export const SESSION = 'session-fixture';
export const SIDE_EFFECTS_WINDOW: Window = {
  from: '2026-10-25T08:40:00.000Z',
  to: '2026-10-25T09:10:00.000Z',
};

const AGENT = { type: 'agent', id: 'coding-agent', name: 'coding-agent' } as const;

interface ToolSpec {
  n: number;
  at: string;
  name: string;
  system: string;
  operation: string;
  attrs?: Record<string, string | number | boolean>;
}

// A tool call and its result, reported by the agent's own telemetry; buildGraph joins them by call id.
export function toolPair(spec: ToolSpec): Event[] {
  const callId = `call-${String(spec.n)}`;
  const shared = {
    'gen_ai.tool.name': spec.name,
    'gen_ai.tool.call.id': callId,
    'gen_ai.operation.name': 'execute_tool',
    ...spec.attrs,
  };
  const target = { system: spec.system, operation: spec.operation };
  return [
    ev({
      n: spec.n,
      at: spec.at,
      kind: 'tool.call',
      provenance: 'reported',
      source: 'otlp',
      runId: SESSION,
      actor: AGENT,
      target,
      attrs: shared,
      summary: `${spec.name}()`,
    }),
    ev({
      n: spec.n + 1,
      at: `${spec.at.slice(0, 17)}${String(Number(spec.at.slice(17, 19)) + 1).padStart(2, '0')}${spec.at.slice(19)}`,
      kind: 'tool.result',
      provenance: 'reported',
      source: 'otlp',
      runId: SESSION,
      actor: AGENT,
      target,
      attrs: shared,
      summary: `${spec.name}() → ok`,
    }),
  ];
}

// Values invented (D-079): the request id, key id, accounts and endpoints are made up.
export const sideEffectsSession: Event[] = [
  claim({
    n: 1,
    at: ist('14:30:11'),
    text: 'Opened PR #311 with the fix.',
    predicate: 'pr.opened',
    subject: { system: 'github', resource: 'billing-api' },
    params: { number: 311 },
  }),
  claim({
    n: 2,
    at: ist('14:31:00'),
    text: 'I may have touched the webhook config.',
    predicate: 'unchecked',
    subject: { system: 'stripe' },
    modality: 'hedged',
  }),
  claim({
    n: 3,
    at: ist('14:31:30'),
    text: 'Cleaned up the old exports bucket on staging.',
    predicate: 'unchecked',
    subject: { system: 'aws', environment: 'staging', resource: 'exports' },
  }),
  gitState(9, ist('14:10:30'), 'c0ffee5d1a2b3c4e5f60718293a4b5c6d7e8f901', []),
  gitState(10, ist('14:26:00'), SHA_B, [[12, 3, 'src/billing/invoice.ts']]),
  ...toolPair({
    n: 20,
    at: ist('14:28:00'),
    name: 'stripe_delete_webhook_endpoint',
    system: 'stripe',
    operation: 'webhook_endpoint.delete',
    attrs: { 'request.id': 'req_7f3a9c1e2b', 'idempotency.key': 'idem-51c2' },
  }),
  ...toolPair({
    n: 22,
    at: ist('14:29:00'),
    name: 's3_delete_object',
    system: 'aws',
    operation: 'DeleteObject',
    attrs: { 'access.key_id': 'AKIAFIXTURE7Q2R' },
  }),
  ...toolPair({
    n: 24,
    at: ist('14:30:00'),
    name: 'gh_pr_create',
    system: 'github',
    operation: 'pull_request.create',
    attrs: { 'request.id': 'gh-req-311' },
  }),
  ...toolPair({
    n: 26,
    at: ist('14:30:40'),
    name: 'vercel_deploy',
    system: 'vercel',
    operation: 'deployment.create',
  }),
  witness({
    n: 30,
    at: ist('14:28:02'),
    target: {
      system: 'stripe',
      resource: 'webhook_endpoints/we_1Q9f3a',
      environment: 'production',
      operation: 'webhook_endpoint.deleted',
    },
    attrs: {
      'request.id': 'req_7f3a9c1e2b',
      'idempotency.key': 'idem-51c2',
      'stripe.livemode': true,
    },
    summary: 'webhook endpoint we_1Q9f3a deleted (livemode)',
  }),
  witness({
    n: 31,
    at: ist('14:29:01'),
    target: {
      system: 'aws',
      resource: 'exports-prod/2026-10/invoices.csv',
      environment: 'production',
      operation: 'DeleteObject',
    },
    attrs: { 'access.key_id': 'AKIAFIXTURE7Q2R', 'request.id': 'aws-req-0d4c' },
    summary: 'DeleteObject exports-prod/2026-10/invoices.csv by AKIAFIXTURE7Q2R',
  }),
  witness({
    n: 32,
    at: ist('14:29:30'),
    actor: { type: 'human', id: 'carol-rev' },
    target: {
      system: 'neon',
      resource: 'billing-db/branches/main/invoices',
      environment: 'production',
      operation: 'update',
    },
    attrs: { 'world.rows': 3 },
    summary: 'carol-rev: UPDATE invoices on branch main: 3 rows',
  }),
  {
    ...prOpened(33, ist('14:30:01'), 311, SHA_B),
    attrs: { ...prOpened(33, ist('14:30:01'), 311, SHA_B).attrs, 'request.id': 'gh-req-311' },
  },
  witness({
    n: 34,
    at: ist('14:30:45'),
    target: {
      system: 'vercel',
      resource: 'billing-web/deployments/dpl_7f3a',
      environment: 'staging',
      operation: 'deployment.created',
    },
    attrs: { 'commit.sha': SHA_B },
    summary: 'preview deployment dpl_7f3a created for b7d4e90',
  }),
  witness({
    n: 35,
    at: ist('14:29:03'),
    kind: 'world.read',
    target: {
      system: 'aws',
      resource: 'exports-prod/2026-10',
      environment: 'production',
      operation: 'ListObjects',
    },
    attrs: { 'access.key_id': 'AKIAFIXTURE7Q2R' },
    summary: 'ListObjects exports-prod/2026-10 by AKIAFIXTURE7Q2R',
  }),
  witness({
    n: 36,
    at: ist('14:45:00'),
    target: {
      system: 'stripe',
      resource: 'webhook_endpoints/we_1Q9f3b',
      environment: 'production',
      operation: 'webhook_endpoint.deleted',
    },
    attrs: { 'request.id': 'req_7f3a9c1e2b' },
    summary: 'webhook endpoint we_1Q9f3b deleted after the window',
  }),
];
