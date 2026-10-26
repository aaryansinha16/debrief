import { describe, expect, it } from 'vitest';

import { verdictEvent } from './event.js';
import type { ClaimRecord, Verdict } from './types.js';

const claim: ClaimRecord = {
  id: '01JBV000000000000000000001',
  seq: 1,
  saidAt: '2026-10-25T14:27:40.000+05:30',
  text: 'All 142 tests pass.',
  modality: 'asserted',
  predicate: 'tests.passed',
  subject: { system: 'github' },
  params: { passed: 142 },
};

describe('verdictEvent', () => {
  it('writes every verdict field as an attr, leaving absent ones out', () => {
    const full: Verdict = {
      claimId: claim.id,
      outcome: 'holds',
      evidence: ['01JBV000000000000000000026'],
      trust: 'third-party',
      checker: 'tests.passed@1',
      reason: 'r',
      supersedes: '01JBV000000000000000000040',
    };
    expect(verdictEvent(full, claim, 'run-1', '2026-10-25T09:12:00.000Z')).toEqual({
      source: 'api',
      provenance: 'derived',
      kind: 'verdict',
      runId: 'run-1',
      sourceTs: '2026-10-25T09:12:00.000Z',
      actor: { type: 'system', id: 'debrief-verdict' },
      target: { system: 'github' },
      attrs: {
        'verdict.claim_id': claim.id,
        'verdict.outcome': 'holds',
        'verdict.checker': 'tests.passed@1',
        'verdict.reason': 'r',
        'verdict.evidence': '01JBV000000000000000000026',
        'verdict.trust': 'third-party',
        'verdict.supersedes': '01JBV000000000000000000040',
      },
      summary: 'verdict holds for tests.passed (tests.passed@1)',
    });
    const bare: Verdict = {
      claimId: claim.id,
      outcome: 'no-witness',
      evidence: [],
      checker: 'tests.passed@1',
      reason: 'r',
    };
    expect(Object.keys(verdictEvent(bare, claim, 'run-1', 't').attrs)).toEqual([
      'verdict.claim_id',
      'verdict.outcome',
      'verdict.checker',
      'verdict.reason',
    ]);
  });
});
