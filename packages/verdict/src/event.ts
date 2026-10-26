import { type Attrs, type EventInput, encodeEvidence, verdictAttrsSchema } from '@debrief/schema';

import { cut } from './check.js';
import type { ClaimRecord, Verdict } from './types.js';

const validated = (attrs: Attrs): Attrs => {
  verdictAttrsSchema.parse(attrs);
  return attrs;
};

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
    'verdict.reason': cut(verdict.reason),
  };
  const evidence = encodeEvidence(verdict.evidence);
  if (evidence !== undefined) attrs['verdict.evidence'] = evidence;
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
    attrs: validated(attrs),
    summary: `verdict ${verdict.outcome} for ${claim.predicate} (${verdict.checker})`,
  };
}
