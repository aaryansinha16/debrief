import { type Event, VERDICT_EVIDENCE_MAX, encodeEvidence } from '@debrief/schema';

import { CHECKERS, UNCHECKED, checkerName } from './checkers/index.js';
import { isCi, reportEdited } from './checkers/ci.js';
import { claimsOf } from './claims.js';
import { contextOf, thirdPartyOnly } from './select.js';
import type { CheckInput, ClaimRecord, Context, Finding, Verdict } from './types.js';

const REASON_MAX = 280;

const cut = (reason: string): string =>
  reason.length <= REASON_MAX ? reason : `${reason.slice(0, REASON_MAX - 1)}…`;

const ids = (events: readonly Event[]): string[] =>
  (encodeEvidence(events.map((e) => e.id)) ?? '')
    .split(',')
    .filter((id) => id !== '')
    .slice(0, VERDICT_EVIDENCE_MAX);

// Third-party evidence alone must reach the outcome for the verdict to be third-party (§18.4).
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
    ids(thirdParty.evidence).join(',') === ids(finding.evidence).join(',');
  const settled = finding;
  const edited = isCiClaim(settled) ? reportEdited(settled.evidence, ctx) : undefined;
  const trust = alone && edited === undefined ? 'third-party' : 'local';
  const reason =
    edited === undefined
      ? settled.reason
      : `${settled.reason}; the session edited ${edited}, so the report is trusted as the agent's machine`;
  return {
    ...base,
    outcome: settled.outcome,
    evidence: ids(settled.evidence),
    trust,
    reason: cut(reason),
  };
}

const isCiClaim = (finding: Finding): boolean => finding.evidence.some(isCi);

export function verdicts(input: CheckInput): Verdict[] {
  const ctx = contextOf(input.events, input.window);
  return claimsOf(input.events).map((claim) => judge(claim, ctx));
}

interface Prior {
  id: string;
  outcome: string;
  evidence: string;
  checker: string;
  trust: string;
}

// The latest recorded verdict per claim: the one no later verdict supersedes, else the highest seq.
export function priorVerdicts(events: readonly Event[]): Map<string, Prior> {
  const superseded = new Set<string>();
  const byClaim = new Map<string, Event[]>();
  for (const event of events) {
    if (event.kind !== 'verdict') continue;
    const claimId = event.attrs['verdict.claim_id'];
    const supersedes = event.attrs['verdict.supersedes'];
    if (typeof claimId !== 'string') continue;
    if (typeof supersedes === 'string') superseded.add(supersedes);
    byClaim.set(claimId, [...(byClaim.get(claimId) ?? []), event]);
  }
  const latest = new Map<string, Prior>();
  for (const [claimId, all] of byClaim) {
    const heads = all.filter((e) => !superseded.has(e.id));
    const head = (heads.length > 0 ? heads : all).reduce((a, b) => (b.seq > a.seq ? b : a));
    latest.set(claimId, {
      id: head.id,
      outcome: String(head.attrs['verdict.outcome']),
      evidence: String(head.attrs['verdict.evidence'] ?? ''),
      checker: String(head.attrs['verdict.checker']),
      trust: String(head.attrs['verdict.trust'] ?? ''),
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
    const same =
      last.outcome === verdict.outcome &&
      last.evidence === verdict.evidence.join(',') &&
      last.checker === verdict.checker &&
      last.trust === (verdict.trust ?? '');
    return same ? [] : [{ ...verdict, supersedes: last.id }];
  });
}
