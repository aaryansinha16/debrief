import type { Verdict, Window } from '@debrief/verdict';
import { type Event, decodeEvidence } from '@debrief/schema';
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

// The span of the session's messages in source time: the hook stamps them from the transcript, not the agent's output.
export function messageSpan(events: readonly Event[]): Span | undefined {
  let span: Span | undefined;
  for (const event of events) {
    if (!isSessionEvent(event)) continue;
    const at = sourceMillis(event);
    if (at === undefined) continue;
    span =
      span === undefined
        ? { from: at, to: at }
        : { from: Math.min(span.from, at), to: Math.max(span.to, at) };
  }
  return span;
}

// Padded so a CI run that finishes after the last Stop still counts, and capped back from the last message (P-65.2).
export function windowOf(span: Span, margins: WindowMargins): Window {
  const to = span.to + margins.afterMs;
  const from = Math.max(span.from - margins.beforeMs, to - margins.maxSpanMs);
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

// Source times are compared here, never in SQL: a text column with mixed offsets does not sort by time (D-091).
export function spansOf(rows: readonly Pick<Event, 'runId' | 'sourceTs'>[]): Map<string, Span> {
  const spans = new Map<string, Span>();
  for (const row of rows) {
    const at = sourceMillis(row);
    if (at === undefined) continue;
    const current = spans.get(row.runId);
    spans.set(
      row.runId,
      current === undefined
        ? { from: at, to: at }
        : { from: Math.min(current.from, at), to: Math.max(current.to, at) },
    );
  }
  return spans;
}

export function sessionWindow(
  events: readonly Event[],
  margins: WindowMargins,
): Window | undefined {
  const span = messageSpan(events);
  return span === undefined ? undefined : windowOf(span, margins);
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

export interface PageEvents {
  events: Event[];
  missing: string[];
}

const isCall = (event: Event | undefined): boolean =>
  event?.kind === 'tool.call' || event?.kind === 'mcp.request';

// D-092: the page gets the session's claims and verdicts, every event any of them cites, and each side effect's world event and tool call.
export function pageEvents(
  all: readonly Event[],
  runId: string,
  verdicts: readonly Verdict[],
  effects: readonly { worldEventId: string; toolEventIds: readonly string[] }[],
): PageEvents {
  const byId = new Map(all.map((event) => [event.id, event]));
  const wanted = new Set<string>();
  for (const event of all) {
    if ((event.kind === 'claim' || event.kind === 'verdict') && event.runId === runId) {
      wanted.add(event.id);
      if (event.kind === 'verdict') {
        const cited = event.attrs['verdict.evidence'];
        for (const id of decodeEvidence(typeof cited === 'string' ? cited : undefined)) {
          wanted.add(id);
        }
      }
    }
  }
  for (const verdict of verdicts) for (const id of verdict.evidence) wanted.add(id);
  for (const effect of effects) {
    wanted.add(effect.worldEventId);
    for (const id of effect.toolEventIds) if (isCall(byId.get(id))) wanted.add(id);
  }
  return {
    events: all.filter((event) => wanted.has(event.id)),
    missing: [...wanted].filter((id) => !byId.has(id)).sort(),
  };
}

// The assistant's own actor: the hook also stores the user's prompts as `agent.message`, with a human actor.
export const agentOf = (events: readonly Event[]): string | undefined =>
  events.find(
    (event) =>
      isSessionEvent(event) && (event.actor.type === 'agent' || event.actor.type === 'subagent'),
  )?.actor.id;

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
