import type { Verdict, Window } from '@debrief/verdict';
import type { Event } from '@debrief/schema';

// ARCHITECTURE §18.2: a session is a run with the assistant's own messages in it.
export const isSessionEvent = (event: Event): boolean => event.kind === 'agent.message';

export interface WindowMargins {
  beforeMs: number;
  afterMs: number;
}

// The window spans the session's reported events, padded so a CI run that finishes after the last Stop still counts.
export function sessionWindow(
  events: readonly Event[],
  margins: WindowMargins,
): Window | undefined {
  const times = events
    .filter((event) => event.provenance === 'reported')
    .map((event) => Date.parse(event.sourceTs))
    .filter((at) => Number.isFinite(at));
  if (times.length === 0) return undefined;
  return {
    from: new Date(Math.min(...times) - margins.beforeMs).toISOString(),
    to: new Date(Math.max(...times) + margins.afterMs).toISOString(),
  };
}

// One source id per distinct verdict, so two checks racing on the same evidence append it once.
export const verdictSourceId = (verdict: Verdict): string =>
  [
    'verdict',
    verdict.claimId,
    verdict.checker,
    verdict.outcome,
    verdict.trust ?? '',
    verdict.evidence.join(','),
    verdict.supersedes ?? '',
  ].join(':');

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
