import {
  type Event,
  type VerdictOutcome,
  claimAttrsSchema,
  verdictAttrsSchema,
  type WitnessTrust,
  WITNESS_TRUST_ATTR,
  decodeEvidence,
  attrValueSchema,
  claimModalitySchema,
  eventKindSchema,
  sourceTimestampSchema,
  targetSchema,
  ulidSchema,
  verdictOutcomeSchema,
  witnessTrustSchema,
} from '@debrief/schema';
import { z } from 'zod';

import { type SessionCheckInput, sessionInputSchema } from './session-check-input';

export const evidenceViewSchema = z.strictObject({
  id: ulidSchema,
  kind: eventKindSchema,
  target: targetSchema.optional(),
  summary: z.string().optional(),
  at: sourceTimestampSchema,
  trust: witnessTrustSchema,
});

export const verdictViewSchema = z.strictObject({
  id: ulidSchema,
  outcome: verdictOutcomeSchema,
  trust: witnessTrustSchema.optional(),
  checker: z.string(),
  reason: z.string(),
  at: sourceTimestampSchema,
  evidence: z.array(evidenceViewSchema),
  supersedes: ulidSchema.optional(),
});

export const claimStateSchema = z.enum([
  'contradicted',
  'holds',
  'no-witness',
  'pending',
  'hedged',
]);

export const claimViewSchema = z.strictObject({
  id: ulidSchema,
  text: z.string(),
  saidAt: sourceTimestampSchema,
  modality: claimModalitySchema,
  predicate: z.string(),
  subject: targetSchema,
  params: z.record(z.string(), attrValueSchema),
  state: claimStateSchema,
  witness: z.enum(['connected', 'missing']),
  verdict: verdictViewSchema.optional(),
  history: z.array(verdictViewSchema),
});

const count = z.number().int().min(0);

// `claims` counts the scored ones: asserted, with a verdict. Hedged claims are shown and never scored (§18.3).
export const checkCountsSchema = z.strictObject({
  claims: count,
  holds: count,
  contradicted: count,
  noWitness: count,
  local: count,
  pending: count,
  hedged: count,
});

export const sessionCheckSchema = z.strictObject({
  session: sessionInputSchema,
  counts: checkCountsSchema,
  claims: z.array(claimViewSchema),
});

export type EvidenceView = z.infer<typeof evidenceViewSchema>;
export type VerdictView = z.infer<typeof verdictViewSchema>;
export type ClaimState = z.infer<typeof claimStateSchema>;
export type ClaimView = z.infer<typeof claimViewSchema>;
export type CheckCounts = z.infer<typeof checkCountsSchema>;
export type SessionCheck = z.infer<typeof sessionCheckSchema>;

// D-083: an observed event stored before witness trust existed counts as local.
const trustOf = (event: Event): WitnessTrust =>
  event.attrs[WITNESS_TRUST_ATTR] === 'third-party' ? 'third-party' : 'local';

const evidenceView = (event: Event): EvidenceView => ({
  id: event.id,
  kind: event.kind,
  target: event.target,
  summary: event.summary,
  at: event.sourceTs,
  trust: trustOf(event),
});

function verdictView(event: Event, byId: ReadonlyMap<string, Event>): VerdictView {
  const attrs = verdictAttrsSchema.parse(event.attrs);
  const evidence = decodeEvidence(attrs['verdict.evidence'])
    .map((id) => byId.get(id))
    .filter((cited): cited is Event => cited?.provenance === 'observed');
  return {
    id: event.id,
    outcome: attrs['verdict.outcome'],
    trust: attrs['verdict.trust'],
    checker: attrs['verdict.checker'],
    reason: attrs['verdict.reason'],
    at: event.sourceTs,
    evidence: evidence.map(evidenceView),
    supersedes: attrs['verdict.supersedes'],
  };
}

// The latest verdict is the newest one nothing supersedes; the others stay as history, newest first (§18.4).
function latestOf(verdicts: readonly Event[]): { latest?: Event; history: Event[] } {
  const newest = [...verdicts].sort((a, b) => b.seq - a.seq);
  const superseded = new Set(newest.map((verdict) => verdict.attrs['verdict.supersedes']));
  const latest = newest.find((verdict) => !superseded.has(verdict.id)) ?? newest[0];
  return { latest, history: newest.filter((verdict) => verdict !== latest) };
}

const STATE_RANK: Record<ClaimState, number> = {
  contradicted: 0,
  holds: 1,
  'no-witness': 2,
  pending: 3,
  hedged: 4,
};
const trustRank = (trust: WitnessTrust | undefined): number =>
  trust === 'third-party' ? 0 : trust === 'local' ? 1 : 2;

// Contradictions first, then what holds on third-party records before what holds on local ones, then by time said.
export const claimOrder = (a: ClaimView, b: ClaimView): number =>
  STATE_RANK[a.state] - STATE_RANK[b.state] ||
  trustRank(a.verdict?.trust) - trustRank(b.verdict?.trust) ||
  Date.parse(a.saidAt) - Date.parse(b.saidAt) ||
  a.id.localeCompare(b.id);

function claimView(
  event: Event,
  verdicts: readonly Event[],
  byId: ReadonlyMap<string, Event>,
  connected: ReadonlySet<string>,
): ClaimView {
  const attrs = claimAttrsSchema.parse(event.attrs);
  const params = Object.fromEntries(
    Object.entries(event.attrs)
      .filter(([key]) => key.startsWith('claim.param.'))
      .map(([key, value]) => [key.slice('claim.param.'.length), value]),
  );
  const { latest, history } = latestOf(verdicts);
  const verdict = latest === undefined ? undefined : verdictView(latest, byId);
  const hedged = attrs['claim.modality'] === 'hedged';
  const subject = event.target ?? { system: 'unknown' };
  return {
    id: event.id,
    text: attrs['claim.text'],
    saidAt: event.sourceTs,
    modality: attrs['claim.modality'],
    predicate: attrs['claim.predicate'],
    subject,
    params,
    state: hedged ? 'hedged' : (verdict?.outcome ?? 'pending'),
    witness: connected.has(subject.system) ? 'connected' : 'missing',
    verdict,
    history: history.map((earlier) => verdictView(earlier, byId)),
  };
}

const isScored = (state: ClaimState): state is VerdictOutcome =>
  state !== 'pending' && state !== 'hedged';

export function countClaims(claims: readonly ClaimView[]): CheckCounts {
  const of = (state: ClaimState): number => claims.filter((claim) => claim.state === state).length;
  const scored = claims.filter((claim) => isScored(claim.state));
  return {
    claims: scored.length,
    holds: of('holds'),
    contradicted: of('contradicted'),
    noWitness: of('no-witness'),
    local: scored.filter((claim) => claim.verdict?.trust === 'local').length,
    pending: of('pending'),
    hedged: of('hedged'),
  };
}

// Pure: the same payload in any order or with repeated events gives the same check.
export function buildSessionCheck(input: SessionCheckInput): SessionCheck {
  const byId = new Map(input.events.map((event) => [event.id, event]));
  const connected = new Set(
    input.witnesses.filter((witness) => witness.state === 'connected').map((w) => w.system),
  );
  const events = [...byId.values()];
  const verdicts = events.filter((event) => event.kind === 'verdict');
  const claims = events
    .filter((event) => event.kind === 'claim')
    .map((claim) =>
      claimView(
        claim,
        verdicts.filter((verdict) => verdict.attrs['verdict.claim_id'] === claim.id),
        byId,
        connected,
      ),
    )
    .sort(claimOrder);
  return {
    session: input.session,
    counts: countClaims(claims),
    claims,
  };
}
