import { type Event, VERDICT_EVIDENCE_MAX, encodeEvidence } from '@debrief/schema';

import { CHECKERS, UNCHECKED, checkerName } from './checkers/index.js';
import { isCi, reportEdited } from './checkers/ci.js';
import { claimsOf } from './claims.js';
import { contextOf, thirdPartyOnly } from './select.js';
import type { CheckInput, ClaimRecord, Context, Finding, Verdict } from './types.js';

export const REASON_MAX = 280;

export const cut = (reason: string): string => {
  const points = Array.from(reason);
  return points.length <= REASON_MAX ? reason : `${points.slice(0, REASON_MAX - 1).join('')}…`;
};

const allIds = (events: readonly Event[]): string[] =>
  (encodeEvidence(events.map((e) => e.id)) ?? '').split(',').filter((id) => id !== '');

const ids = (events: readonly Event[]): string[] => allIds(events).slice(0, VERDICT_EVIDENCE_MAX);

// Third-party evidence alone must reach the same verdict for it to be third-party (§18.4).
export function judge(claim: ClaimRecord, ctx: Context): Verdict {
  const checker = checkerName(claim.predicate);
  const base = { claimId: claim.id, checker };
  if (claim.modality === 'hedged') {
    return {
      ...base,
      outcome: 'no-witness',
      evidence: [],
      reason: 'hedged claim: shown, never scored',
    };
  }
  const entry = checker === UNCHECKED ? undefined : CHECKERS[claim.predicate];
  if (entry === undefined) {
    return { ...base, outcome: 'no-witness', evidence: [], reason: 'no checker for this sentence' };
  }
  const { check } = entry;
  const finding = check(claim, ctx);
  if (finding.outcome === 'no-witness') {
    return {
      ...base,
      outcome: 'no-witness',
      evidence: ids(finding.evidence),
      reason: cut(finding.reason),
    };
  }
  const thirdParty = check(claim, thirdPartyOnly(ctx));
  const alone =
    thirdParty.outcome === finding.outcome &&
    allIds(thirdParty.evidence).join(',') === allIds(finding.evidence).join(',');
  const edited = isCiClaim(finding) ? reportEdited(finding.evidence, ctx) : undefined;
  const trust = alone && edited === undefined ? 'third-party' : 'local';
  const reason =
    edited === undefined
      ? finding.reason
      : `${finding.reason}; the session edited ${edited}, so the report is trusted as the agent's machine`;
  return {
    ...base,
    outcome: finding.outcome,
    evidence: ids(finding.evidence),
    trust,
    reason: cut(reason),
  };
}

const isCiClaim = (finding: Finding): boolean => finding.evidence.some(isCi);

// A claim said before the window opens is about work the window no longer shows (P-65.2); an unreadable time is not scored.
function early(claim: ClaimRecord, window: CheckInput['window']): string | undefined {
  const said = Date.parse(claim.saidAt);
  if (Number.isNaN(said)) return 'said at a time this check cannot read';
  return said < Date.parse(window.from)
    ? `said before the window this check reads, which opens ${window.from}`
    : undefined;
}

// A scored verdict recorded while the window still showed the work stays the claim's verdict (D-095).
function recorded(claimId: string, last: Prior): Verdict | undefined {
  if (last.outcome !== 'holds' && last.outcome !== 'contradicted') return undefined;
  return {
    claimId,
    checker: last.checker,
    outcome: last.outcome,
    evidence: last.evidence.split(',').filter((id) => id !== ''),
    ...(last.trust === 'third-party' || last.trust === 'local' ? { trust: last.trust } : {}),
    reason: last.reason,
  };
}

export function verdicts(input: CheckInput): Verdict[] {
  const claims = claimsOf(input.events);
  const ctx = contextOf(input.events, input.window, new Set(claims.map((c) => c.runId)));
  const prior = priorVerdicts(input.events);
  return claims.map((claim) => {
    const verdict = judge(claim, ctx);
    if (verdict.checker === UNCHECKED || claim.modality === 'hedged') return verdict;
    const why = early(claim, input.window);
    if (why === undefined) return verdict;
    const last = prior.get(claim.id);
    return (
      (last === undefined ? undefined : recorded(claim.id, last)) ?? {
        claimId: claim.id,
        checker: verdict.checker,
        outcome: 'no-witness',
        evidence: [],
        reason: why,
      }
    );
  });
}

export interface Prior {
  id: string;
  outcome: string;
  evidence: string;
  checker: string;
  trust: string;
  reason: string;
}

// The record already says this: same outcome, evidence, checker and trust.
export const recordedMatches = (last: Prior, verdict: Verdict): boolean =>
  last.outcome === verdict.outcome &&
  last.evidence === verdict.evidence.join(',') &&
  last.checker === verdict.checker &&
  last.trust === (verdict.trust ?? '');

// The latest recorded verdict per claim: the one no later verdict for that claim supersedes, else the highest seq.
export function priorVerdicts(events: readonly Event[]): Map<string, Prior> {
  const byClaim = new Map<string, { events: Event[]; superseded: Set<string> }>();
  for (const event of events) {
    if (event.kind !== 'verdict') continue;
    const claimId = event.attrs['verdict.claim_id'];
    const supersedes = event.attrs['verdict.supersedes'];
    if (typeof claimId !== 'string') continue;
    const chain = byClaim.get(claimId) ?? { events: [], superseded: new Set<string>() };
    chain.events.push(event);
    if (typeof supersedes === 'string') chain.superseded.add(supersedes);
    byClaim.set(claimId, chain);
  }
  const latest = new Map<string, Prior>();
  for (const [claimId, { events: all, superseded }] of byClaim) {
    const heads = all.filter((e) => !superseded.has(e.id));
    const head = (heads.length > 0 ? heads : all).reduce((a, b) => (b.seq > a.seq ? b : a));
    latest.set(claimId, {
      id: head.id,
      outcome: String(head.attrs['verdict.outcome']),
      evidence: String(head.attrs['verdict.evidence'] ?? ''),
      checker: String(head.attrs['verdict.checker']),
      trust: String(head.attrs['verdict.trust'] ?? ''),
      reason: String(head.attrs['verdict.reason'] ?? ''),
    });
  }
  return latest;
}

// What is not yet in the record: a first verdict, or one that differs from the latest recorded (§18.4).
export function pendingVerdicts(input: CheckInput): Verdict[] {
  const prior = priorVerdicts(input.events);
  return verdicts(input).flatMap((verdict) => {
    const last = prior.get(verdict.claimId);
    if (last === undefined) return [verdict];
    return recordedMatches(last, verdict) ? [] : [{ ...verdict, supersedes: last.id }];
  });
}
