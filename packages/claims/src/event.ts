import type { Attrs, EventInput } from '@debrief/schema';

import type { Claim, Span } from './extract.js';

export type ClaimEventInput = Omit<EventInput, 'id' | 'ts' | 'tenantId'>;

// ARCHITECTURE §18.3, D-083: the subject is the target, saidAt the source time, the session the run.
export function claimEvent(claim: Claim, runId: string): ClaimEventInput {
  const attrs: Attrs = {
    'claim.text': claim.text,
    'claim.span.message_id': claim.span.messageId,
    'claim.span.start': claim.span.start,
    'claim.span.end': claim.span.end,
    'claim.modality': claim.modality,
    'claim.predicate': claim.predicate,
  };
  for (const [name, value] of Object.entries(claim.params)) attrs[`claim.param.${name}`] = value;
  return {
    source: 'api',
    provenance: 'derived',
    kind: 'claim',
    runId,
    sourceTs: claim.saidAt,
    actor: { type: 'system', id: 'debrief-claims' },
    target: claim.subject,
    attrs,
    summary: `claim ${claim.predicate} (${claim.modality})`,
  };
}

export function claimSpan(attrs: Attrs): Span | undefined {
  const messageId = attrs['claim.span.message_id'];
  const start = attrs['claim.span.start'];
  const end = attrs['claim.span.end'];
  return typeof messageId === 'string' && typeof start === 'number' && typeof end === 'number'
    ? { messageId, start, end }
    : undefined;
}

// A claim already in the record keeps its place: a re-extraction appends only spans that overlap none (§18.2).
export const overlapsAny = (span: Span, existing: readonly Span[]): boolean =>
  existing.some(
    (other) =>
      other.messageId === span.messageId && span.start < other.end && other.start < span.end,
  );
