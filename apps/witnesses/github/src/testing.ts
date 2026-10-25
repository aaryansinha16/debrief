import type { GithubWireEvent } from '@debrief/witness-github';

import type { Sink } from './sink.js';

export interface MemorySink extends Sink {
  stored: Map<string, GithubWireEvent>;
  calls: number;
}

export function memorySink(): MemorySink {
  const stored = new Map<string, GithubWireEvent>();
  return {
    stored,
    calls: 0,
    post(events) {
      this.calls += 1;
      let duplicates = 0;
      for (const event of events) {
        if (stored.has(event.sourceId)) duplicates += 1;
        else stored.set(event.sourceId, event);
      }
      return Promise.resolve({ accepted: events.length - duplicates, duplicates });
    },
  };
}

export const bySourceId = (events: Iterable<GithubWireEvent>): GithubWireEvent[] =>
  [...events].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
