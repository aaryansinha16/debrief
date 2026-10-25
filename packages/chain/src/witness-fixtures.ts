import type { UnhashedEvent } from './hash.js';

const TENANT = 'tenant-demo';
const RUN = '9c1d4e7f2a3b4c5d6e7f8091a2b3c4d5';
const at = (seq: number): string => `2026-10-26T00:00:0${String(seq)}.000Z`;
const id = (seq: number): string => `01JB3A7M5K2N8P4Q6R9S1T3V5${String(seq)}`;

// One event of each kind P-61 adds (D-083), so their hashes are pinned in Node and jsdom.
const EVENTS: readonly UnhashedEvent[] = [
  {
    id: id(0),
    tenantId: TENANT,
    seq: 0,
    ts: at(0),
    sourceTs: '2026-10-26T05:30:00.000+05:30',
    source: 'world-hook',
    provenance: 'observed',
    runId: RUN,
    kind: 'world.change',
    actor: { type: 'system', id: 'orbital-infra' },
    target: {
      system: 'orbital',
      resource: 'projects/nova/ci/runs/812',
      environment: 'staging',
      operation: 'ci.completed',
    },
    attrs: {
      'witness.trust': 'third-party',
      'world.tests.passed': 139,
      'world.tests.failed': 0,
      'world.tests.skipped': 3,
    },
    summary: 'CI run 812 finished: 139 passed, 3 skipped',
  },
  {
    id: id(1),
    tenantId: TENANT,
    seq: 1,
    ts: at(1),
    sourceTs: at(1),
    source: 'world-hook',
    provenance: 'observed',
    runId: RUN,
    kind: 'world.read',
    actor: { type: 'system', id: 'orbital-infra' },
    target: {
      system: 'orbital',
      resource: 'projects/nova/db/users',
      environment: 'production',
      operation: 'select',
    },
    attrs: { 'witness.trust': 'third-party', 'world.rows': 12 },
    summary: 'SELECT on users returned 12 rows',
  },
  {
    id: id(2),
    tenantId: TENANT,
    seq: 2,
    ts: at(2),
    sourceTs: at(2),
    source: 'api',
    provenance: 'derived',
    runId: RUN,
    kind: 'claim',
    actor: { type: 'system', id: 'debrief-claims' },
    target: { system: 'orbital', resource: 'projects/nova/ci', environment: 'staging' },
    attrs: {
      'claim.text': 'All 142 tests pass.',
      'claim.span.message_id': 'msg-0007',
      'claim.span.start': 48,
      'claim.span.end': 67,
      'claim.modality': 'asserted',
      'claim.predicate': 'tests.passed',
      'claim.param.passed': 142,
    },
    summary: 'claim: All 142 tests pass.',
  },
  {
    id: id(3),
    tenantId: TENANT,
    seq: 3,
    ts: at(3),
    sourceTs: at(3),
    source: 'api',
    provenance: 'derived',
    runId: RUN,
    kind: 'verdict',
    actor: { type: 'system', id: 'debrief-verdict' },
    attrs: {
      'verdict.claim_id': id(2),
      'verdict.outcome': 'contradicted',
      'verdict.evidence': id(0),
      'verdict.trust': 'third-party',
      'verdict.checker': 'tests.passed@1',
      'verdict.reason': 'CI run 812 recorded 139 passed and 3 skipped, not 142 passed',
    },
    summary: 'contradicted: 139 passed, 3 skipped',
  },
];

export function witnessFixture(): UnhashedEvent[] {
  return JSON.parse(JSON.stringify(EVENTS)) as UnhashedEvent[];
}
