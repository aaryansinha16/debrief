import { describe, expect, it } from 'vitest';

import type { Event } from './event.js';
import { sortTimeline, timelineKey } from './timeline.js';

const ev = (seq: number, sourceTs: string): Event => ({
  id: '01J8ZK5R4M2X6P9Q3V7W1Y5N00',
  tenantId: 't',
  seq,
  ts: '2026-09-17T00:00:00.000Z',
  sourceTs,
  source: 'api',
  provenance: 'reported',
  runId: 'r',
  kind: 'error',
  actor: { type: 'system', id: 'x' },
  attrs: {},
  prevHash: '0'.repeat(64),
  hash: '0'.repeat(64),
});

describe('timeline ordering', () => {
  it('orders by source time to the nanosecond, then by seq', () => {
    const a = ev(5, '2026-09-17T00:00:01.000000500Z');
    const b = ev(1, '2026-09-17T00:00:01.0000004Z');
    const c = ev(3, '2026-09-17T05:30:01+05:30');
    const d = ev(0, '2026-09-17T00:00:01.000000500Z');
    expect(sortTimeline([a, b, c, d]).map((event) => event.seq)).toEqual([3, 1, 0, 5]);
    expect(timelineKey(c)).toEqual([Date.UTC(2026, 8, 17, 0, 0, 1), 0, 3]);
    expect(timelineKey(ev(2, 'garbage'))).toEqual([Number.NaN, 0, 2]);
  });
});
