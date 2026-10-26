import type { Attrs, EventInput } from '@debrief/schema';

import type { ClaimRecord, Verdict } from './types.js';

export type VerdictEventInput = Omit<EventInput, 'id' | 'ts' | 'tenantId'>;

// D-083: a verdict is derived, targets the claim's subject and is timed by when it was computed.
export function verdictEvent(
  verdict: Verdict,
  claim: ClaimRecord,
  runId: string,
  at: string,
): VerdictEventInput {
  const attrs: Attrs = {
    'verdict.claim_id': verdict.claimId,
    'verdict.outcome': verdict.outcome,
    'verdict.checker': verdict.checker,
    'verdict.reason': verdict.reason,
  };
  if (verdict.evidence.length > 0) attrs['verdict.evidence'] = verdict.evidence.join(',');
  if (verdict.trust !== undefined) attrs['verdict.trust'] = verdict.trust;
  if (verdict.supersedes !== undefined) attrs['verdict.supersedes'] = verdict.supersedes;
  return {
    source: 'api',
    provenance: 'derived',
    kind: 'verdict',
    runId,
    sourceTs: at,
    actor: { type: 'system', id: 'debrief-verdict' },
    target: claim.subject,
    attrs,
    summary: `verdict ${verdict.outcome} for ${claim.predicate} (${verdict.checker})`,
  };
}
