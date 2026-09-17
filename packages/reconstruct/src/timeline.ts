import type { Event } from '@debrief/schema';

// (epoch ms, sub-millisecond nanos, seq): source time first so span starts precede the proxy events they caused.
export type TimelineKey = readonly [number, number, number];

const RFC3339 = /^(.*?)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

export function timelineKey(event: Event): TimelineKey {
  const match = RFC3339.exec(event.sourceTs);
  if (match === null) return [Number.NaN, 0, event.seq];
  const [, base = '', fraction = '', zone = 'Z'] = match;
  const millis = Date.parse(`${base}.${fraction.slice(0, 3).padEnd(3, '0')}${zone}`);
  const subMillis = Number(fraction.slice(3).padEnd(6, '0'));
  return [millis, subMillis, event.seq];
}

export const compareKeys = (a: TimelineKey, b: TimelineKey): number =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export function sortTimeline(events: readonly Event[]): Event[] {
  return events
    .map((event) => ({ event, key: timelineKey(event) }))
    .sort((a, b) => compareKeys(a.key, b.key))
    .map((entry) => entry.event);
}
