import { type Event, sortTimeline, timelineKey } from '@debrief/schema';

import { EMPTY_WORLD, type WorldState, applyEvent } from './world-state.js';

export interface TimedEvent {
  event: Event;
  t: number;
}

export interface Replay {
  events: readonly TimedEvent[];
  duration: number;
  startMs: number;
  indexAt(t: number): number;
  timeOf(eventId: string): number | undefined;
  stateAt(t: number): WorldState;
  density(buckets: number): number[];
}

export const SNAPSHOT_EVERY = 500;

// Number of sorted times ≤ t; a hole in the array ends the search.
export function bisectTimes(times: readonly number[], t: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const time = times[mid];
    if (time === undefined) break;
    if (time <= t) low = mid + 1;
    else high = mid;
  }
  return low;
}

// ARCHITECTURE §11: world state at t is a reducer over events ≤ t; snapshots every 500 events keep a seek O(500).
export function createReplay(source: readonly Event[], snapshotEvery = SNAPSHOT_EVERY): Replay {
  const ordered = sortTimeline(source);
  const first = ordered[0];
  const startMs = first === undefined ? 0 : timelineKey(first)[0];
  const events: TimedEvent[] = ordered.map((event) => {
    const [millis, subMillis] = timelineKey(event);
    return { event, t: Math.max(0, millis - startMs + subMillis / 1_000_000) };
  });
  const times = events.map((entry) => entry.t);
  const duration = times[times.length - 1] ?? 0;
  const byId = new Map(events.map((entry) => [entry.event.id, entry.t]));
  const snapshots = new Map<number, WorldState>();
  let running = EMPTY_WORLD;
  events.forEach((entry, index) => {
    running = applyEvent(running, entry.event);
    if ((index + 1) % snapshotEvery === 0) snapshots.set((index + 1) / snapshotEvery, running);
  });
  const indexAt = (t: number): number => bisectTimes(times, t);
  return {
    events,
    duration,
    startMs,
    indexAt,
    timeOf: (eventId) => byId.get(eventId),
    stateAt: (t) => {
      const count = indexAt(t);
      const snapshotIndex = Math.floor(count / snapshotEvery);
      const base = snapshots.get(snapshotIndex) ?? EMPTY_WORLD;
      return events
        .slice(snapshotIndex * snapshotEvery, count)
        .reduce((state, entry) => applyEvent(state, entry.event), base);
    },
    density: (buckets) => {
      const size = Math.max(1, buckets);
      const filled = new Map<number, number>();
      for (const time of times) {
        const bucket =
          duration === 0 ? 0 : Math.min(size - 1, Math.floor((time / duration) * size));
        filled.set(bucket, (filled.get(bucket) ?? 0) + 1);
      }
      return Array.from({ length: size }, (_, bucket) => filled.get(bucket) ?? 0);
    },
  };
}
