import type { Target } from '@debrief/schema';

import {
  type ParamValue,
  type Predicate,
  isCheckedPredicate,
  namesEnvironment,
  predicateParams,
} from './catalogue.js';
import type { Reply, ReplyClaim } from './reply.js';

export const MAX_CLAIM_CHARS = 1000;

const MAX_SUBJECT_CHARS = 280;
const SYSTEM = /^[a-z0-9][a-z0-9._-]{0,63}$/;

// Decided here as well as by the model, over the whole sentence: a hedged claim is shown, never scored (§18.3).
const HEDGE =
  /\b(?:should|might|may|maybe|probably|likely|hopefully|presumably|I think|I believe|I expect|I assume|I guess|I hope|not sure|seems?|appears? to|looks like)\b/i;
const BOUNDARY = /[.!?](?=\s|$)|\n/g;

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

const stated = (value: string | null, text: string): string | undefined => {
  const trimmed = value?.trim() ?? '';
  const fits = trimmed !== '' && trimmed.length <= MAX_SUBJECT_CHARS;
  return fits && text.toLowerCase().includes(trimmed.toLowerCase()) ? trimmed : undefined;
};

// The subject stands on the transcript too: a resource someone named, an environment and operation this message names.
function subjectOf(raw: ReplyClaim['subject'], message: string, transcript: string): Target {
  const system = raw.system.trim().toLowerCase();
  const subject: Target = { system: SYSTEM.test(system) ? system : 'unknown' };
  const resource = stated(raw.resource, transcript);
  const operation = stated(raw.operation, message);
  if (resource !== undefined) subject.resource = resource;
  if (raw.environment !== null && namesEnvironment(message, raw.environment)) {
    subject.environment = raw.environment;
  }
  if (operation !== undefined) subject.operation = operation;
  return subject;
}

export function sentenceAround(text: string, start: number, end: number): string {
  let from = 0;
  for (const match of text.slice(0, start).matchAll(BOUNDARY)) from = match.index + 1;
  const after = text.slice(end - 1).search(BOUNDARY);
  return text.slice(from, after < 0 ? text.length : end + after).trim();
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
  const transcript = messages.map((message) => message.text).join('\n');
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
      modality: HEDGE.test(sentenceAround(message.text, span.start, span.end))
        ? 'hedged'
        : raw.modality,
      predicate,
      subject: subjectOf(raw.subject, message.text, transcript),
      params: predicateParams(predicate, raw.params, { quote, message: message.text }),
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
