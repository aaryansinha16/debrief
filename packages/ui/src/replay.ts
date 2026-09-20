import { type Event, sortTimeline, timelineKey } from '@debrief/schema';

import { EMPTY_WORLD, type WorldState, applyInto, cloneWorld } from './world-state.js';

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

// Story time: every event gets at least a beat and no silence runs longer than a breath, so a one-second incident plays as a scene.
export interface Pacing {
  minGapMs: number;
  maxGapMs: number;
}

export const STORY_PACING: Pacing = { minGapMs: 350, maxGapMs: 1200 };

export function pace(events: readonly TimedEvent[], pacing: Pacing): TimedEvent[] {
  let previous = 0;
  let clock = 0;
  return events.map((entry, index) => {
    const beat =
      index === 0 ? 0 : Math.min(pacing.maxGapMs, Math.max(pacing.minGapMs, entry.t - previous));
    clock += beat;
    previous = entry.t;
    return { event: entry.event, t: clock };
  });
}

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
export function createReplay(
  source: readonly Event[],
  snapshotEvery = SNAPSHOT_EVERY,
  pacing?: Pacing,
): Replay {
  const ordered = sortTimeline(source);
  const first = ordered[0];
  const startMs = first === undefined ? 0 : timelineKey(first)[0];
  const raw: TimedEvent[] = ordered.map((event) => {
    const [millis, subMillis] = timelineKey(event);
    return { event, t: Math.max(0, millis - startMs + subMillis / 1_000_000) };
  });
  const events = pacing === undefined ? raw : pace(raw, pacing);
  const times = events.map((entry) => entry.t);
  const duration = times[times.length - 1] ?? 0;
  const byId = new Map(events.map((entry) => [entry.event.id, entry.t]));
  const snapshots = new Map<number, WorldState>();
  const running = cloneWorld(EMPTY_WORLD);
  events.forEach((entry, index) => {
    applyInto(running, entry.event);
    if ((index + 1) % snapshotEvery === 0) {
      snapshots.set((index + 1) / snapshotEvery, cloneWorld(running));
    }
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
      const draft = cloneWorld(snapshots.get(snapshotIndex) ?? EMPTY_WORLD);
      for (const entry of events.slice(snapshotIndex * snapshotEvery, count)) {
        applyInto(draft, entry.event);
      }
      return draft;
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
