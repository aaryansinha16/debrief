import {
  type Attrs,
  type Event,
  type Target,
  type VerdictOutcome,
  type WitnessTrust,
  encodeEvidence,
} from '@debrief/schema';

export type Draft = Omit<Event, 'tenantId' | 'seq' | 'ts' | 'prevHash' | 'hash'>;

// Readable ULIDs: 01JBC + a letter per kind (Claim, Verdict, Witness, Tool call) + a counter.
export const ulidOf = (kind: 'C' | 'V' | 'W' | 'T', n: number): string =>
  `01JBC${kind}${String(n).padStart(20, '0')}`;

const hex = (n: number): string => n.toString(16).padStart(64, '0');

// Stored events in the order given; the hashes are placeholders shaped like the chain's, not a verifiable chain.
export const stored = (drafts: readonly Draft[], tenantId = 'tenant-sample'): Event[] =>
  drafts.map((draft, seq) => ({
    ...draft,
    tenantId,
    seq,
    ts: new Date(draft.sourceTs).toISOString(),
    prevHash: hex(seq),
    hash: hex(seq + 1),
  }));

export interface ClaimDraft {
  text: string;
  messageId: string;
  start?: number;
  saidAt: string;
  modality?: 'asserted' | 'hedged';
  predicate: string;
  subject: Target;
  params?: Record<string, string | number | boolean>;
}

// ARCHITECTURE §18.3 on the wire, as @debrief/claims' claimEvent writes it.
export function claimDraft(id: string, runId: string, claim: ClaimDraft): Draft {
  const start = claim.start ?? 0;
  const modality = claim.modality ?? 'asserted';
  const attrs: Attrs = {
    'claim.text': claim.text,
    'claim.span.message_id': claim.messageId,
    'claim.span.start': start,
    'claim.span.end': start + claim.text.length,
    'claim.modality': modality,
    'claim.predicate': claim.predicate,
  };
  for (const [name, value] of Object.entries(claim.params ?? {})) {
    attrs[`claim.param.${name}`] = value;
  }
  return {
    id,
    source: 'api',
    provenance: 'derived',
    kind: 'claim',
    runId,
    sourceTs: claim.saidAt,
    actor: { type: 'system', id: 'debrief-claims' },
    target: claim.subject,
    attrs,
    summary: `claim ${claim.predicate} (${modality})`,
  };
}

export interface VerdictDraft {
  claimId: string;
  outcome: VerdictOutcome;
  trust?: WitnessTrust;
  evidence?: readonly string[];
  checker: string;
  reason: string;
  at: string;
  supersedes?: string;
}

// ARCHITECTURE §18.4 on the wire (D-083).
export function verdictDraft(id: string, runId: string, verdict: VerdictDraft): Draft {
  const attrs: Attrs = {
    'verdict.claim_id': verdict.claimId,
    'verdict.outcome': verdict.outcome,
    'verdict.checker': verdict.checker,
    'verdict.reason': verdict.reason,
  };
  const evidence = encodeEvidence(verdict.evidence ?? []);
  if (evidence !== undefined) attrs['verdict.evidence'] = evidence;
  if (verdict.trust !== undefined) attrs['verdict.trust'] = verdict.trust;
  if (verdict.supersedes !== undefined) attrs['verdict.supersedes'] = verdict.supersedes;
  return {
    id,
    source: 'api',
    provenance: 'derived',
    kind: 'verdict',
    runId,
    sourceTs: verdict.at,
    actor: { type: 'system', id: 'debrief-verdict' },
    attrs,
    summary: `verdict ${verdict.outcome} (${verdict.checker})`,
  };
}

export interface ObservedDraft {
  at: string;
  target: Target & { system: string };
  trust: WitnessTrust;
  summary: string;
  runId?: string;
  attrs?: Attrs;
}

// ARCHITECTURE §18.6: a witness's record; a third-party one runs on its system's daily run.
export const observedDraft = (id: string, observed: ObservedDraft): Draft => ({
  id,
  source: 'world-hook',
  provenance: 'observed',
  kind: 'world.change',
  runId: observed.runId ?? `witness:${observed.target.system}:${observed.at.slice(0, 10)}`,
  sourceTs: observed.at,
  actor: { type: 'system', id: `${observed.target.system}-witness` },
  target: observed.target,
  attrs: { ...observed.attrs, 'witness.trust': observed.trust },
  summary: observed.summary,
});

export const toolCallDraft = (id: string, runId: string, at: string, name: string): Draft => ({
  id,
  source: 'api',
  provenance: 'reported',
  kind: 'tool.call',
  runId,
  sourceTs: at,
  actor: { type: 'agent', id: 'coding-agent' },
  target: { system: 'coding-agent', operation: name },
  attrs: { 'gen_ai.tool.name': name, 'gen_ai.tool.call.id': `call-${id.slice(-6)}` },
  summary: `tool call ${name}`,
});
