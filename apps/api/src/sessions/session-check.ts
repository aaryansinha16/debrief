import type { Verdict, Window } from '@debrief/verdict';
import type { Event } from '@debrief/schema';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

// ARCHITECTURE §18.2: a session is a run with the assistant's own messages in it.
export const isSessionEvent = (event: Event): boolean => event.kind === 'agent.message';

export interface WindowMargins {
  beforeMs: number;
  afterMs: number;
  maxSpanMs: number;
}

export const sourceMillis = (event: Pick<Event, 'sourceTs'>): number | undefined => {
  const at = Date.parse(event.sourceTs);
  return Number.isFinite(at) ? at : undefined;
};

export interface Span {
  from: number;
  to: number;
}

// The span of the session's reported events in source time; the agent controls it, so a cap bounds every read of it.
export function reportedSpan(events: readonly Event[]): Span | undefined {
  let span: Span | undefined;
  for (const event of events) {
    if (event.provenance !== 'reported') continue;
    const at = sourceMillis(event);
    if (at === undefined) continue;
    span =
      span === undefined
        ? { from: at, to: at }
        : { from: Math.min(span.from, at), to: Math.max(span.to, at) };
  }
  return span;
}

// Padded so a CI run that finishes after the last Stop still counts, and capped so a far-dated event cannot widen it.
export function sessionWindow(
  events: readonly Event[],
  margins: WindowMargins,
): Window | undefined {
  const span = reportedSpan(events);
  if (span === undefined) return undefined;
  const from = span.from - margins.beforeMs;
  const to = Math.min(span.to + margins.afterMs, from + margins.maxSpanMs);
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

// One source id per distinct verdict, hashed so a hundred evidence ids still fit the dedupe index.
export const verdictSourceId = (verdict: Verdict): string =>
  `verdict:${bytesToHex(
    sha256(
      utf8ToBytes(
        JSON.stringify([
          verdict.claimId,
          verdict.checker,
          verdict.outcome,
          verdict.trust ?? '',
          verdict.evidence,
          verdict.supersedes ?? '',
        ]),
      ),
    ),
  )}`;

export const RESERVED_SOURCE_ID = /^(?:verdict|claim):/;

export function dedupeById(events: readonly Event[]): Event[] {
  const seen = new Map<string, Event>();
  for (const event of events) if (!seen.has(event.id)) seen.set(event.id, event);
  return [...seen.values()];
}

export interface WitnessSummary {
  system: string;
  trust: 'local' | 'third-party';
  events: number;
}

// Which witnesses spoke inside the window, by system and trust, so a surface can name the missing ones.
export function witnessesOf(observed: readonly Event[]): WitnessSummary[] {
  const counts = new Map<string, WitnessSummary>();
  for (const event of observed) {
    const system = event.target?.system ?? 'unknown';
    const trust = event.attrs['witness.trust'] === 'third-party' ? 'third-party' : 'local';
    const key = `${system}\u0000${trust}`;
    const entry = counts.get(key) ?? { system, trust, events: 0 };
    entry.events += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort(
    (a, b) => a.system.localeCompare(b.system) || a.trust.localeCompare(b.trust),
  );
}
