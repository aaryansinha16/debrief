import type { Target } from '@debrief/schema';

import {
  type ParamValue,
  type Predicate,
  isCheckedPredicate,
  predicateParams,
} from './catalogue.js';
import type { Reply, ReplyClaim } from './reply.js';

export const MAX_CLAIM_CHARS = 1000;

// Decided here as well as by the model: a hedged sentence is shown, never scored (§18.3).
const HEDGE =
  /\b(?:should|might|probably|likely|hopefully|presumably|I think|I believe|I expect|seems?|appears? to)\b/i;

export interface TranscriptMessage {
  id: string;
  text: string;
  saidAt: string;
}

export interface Span {
  messageId: string;
  start: number;
  end: number;
}

export interface Claim {
  text: string;
  span: Span;
  saidAt: string;
  modality: 'asserted' | 'hedged';
  predicate: Predicate;
  subject: Target;
  params: Record<string, ParamValue>;
}

export type DropReason =
  'unknown-message' | 'empty-quote' | 'quote-too-long' | 'quote-not-found' | 'repeated';

export interface Extraction {
  claims: Claim[];
  dropped: Record<DropReason, number>;
}

function subjectOf(raw: ReplyClaim['subject']): Target {
  const subject: Target = { system: raw.system.trim().toLowerCase() || 'unknown' };
  const resource = raw.resource?.trim() ?? '';
  const operation = raw.operation?.trim() ?? '';
  if (resource !== '') subject.resource = resource;
  if (raw.environment !== null) subject.environment = raw.environment;
  if (operation !== '') subject.operation = operation;
  return subject;
}

// The model quotes; code finds the quote and computes the UTF-16 span, so every span re-reads by construction.
function locate(
  text: string,
  quote: string,
  taken: readonly Span[],
): number | 'missing' | 'repeated' {
  let start = text.indexOf(quote);
  if (start < 0) return 'missing';
  const clash = (at: number) =>
    taken.some((span) => at < span.end && span.start < at + quote.length);
  while (start >= 0 && clash(start)) start = text.indexOf(quote, start + 1);
  return start < 0 ? 'repeated' : start;
}

export function extractClaims(reply: Reply, messages: readonly TranscriptMessage[]): Extraction {
  const order = new Map(messages.map((message, index) => [message.id, index]));
  const taken = new Map<string, Span[]>();
  const dropped: Record<DropReason, number> = {
    'unknown-message': 0,
    'empty-quote': 0,
    'quote-too-long': 0,
    'quote-not-found': 0,
    repeated: 0,
  };
  const placed: { claim: Claim; rank: number }[] = [];
  for (const raw of reply.claims) {
    const rank = order.get(raw.message_id) ?? -1;
    const message = messages[rank];
    if (message === undefined) {
      dropped['unknown-message'] += 1;
      continue;
    }
    const quote = raw.quote.trim();
    const reason =
      quote === '' ? 'empty-quote' : quote.length > MAX_CLAIM_CHARS ? 'quote-too-long' : undefined;
    if (reason !== undefined) {
      dropped[reason] += 1;
      continue;
    }
    const spans = taken.get(message.id) ?? [];
    const start = locate(message.text, quote, spans);
    if (start === 'missing' || start === 'repeated') {
      dropped[start === 'missing' ? 'quote-not-found' : 'repeated'] += 1;
      continue;
    }
    const span = { messageId: message.id, start, end: start + quote.length };
    taken.set(message.id, [...spans, span]);
    const predicate = isCheckedPredicate(raw.predicate) ? raw.predicate : 'unchecked';
    const claim: Claim = {
      text: quote,
      span,
      saidAt: message.saidAt,
      modality: HEDGE.test(quote) ? 'hedged' : raw.modality,
      predicate,
      subject: subjectOf(raw.subject),
      params: predicateParams(predicate, raw.params),
    };
    placed.push({ claim, rank });
  }
  placed.sort((a, b) => a.rank - b.rank || a.claim.span.start - b.claim.span.start);
  return { claims: placed.map(({ claim }) => claim), dropped };
}

// A claim's span must reproduce its text from the message it cites; receipts re-check this offline.
export function rereads(
  claim: Pick<Claim, 'text' | 'span'>,
  messages: readonly TranscriptMessage[],
): boolean {
  const message = messages.find((candidate) => candidate.id === claim.span.messageId);
  return message?.text.slice(claim.span.start, claim.span.end) === claim.text;
}
