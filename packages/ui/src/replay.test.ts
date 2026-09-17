import { describe, expect, it } from 'vitest';

import { at, ev, syntheticRun, ulid } from './__fixtures__/synthetic-run.js';
import { SNAPSHOT_EVERY, bisectTimes, createReplay } from './replay.js';
import { EMPTY_WORLD, applyEvent } from './world-state.js';

describe('createReplay', () => {
  it('orders events on a millisecond axis from the first event', () => {
    const events = [
      ev(2, 300, { kind: 'error' }),
      ev(0, 100, { kind: 'error' }),
      ev(1, 200, { kind: 'error', sourceTs: '2026-09-17T00:00:00.2000005Z' }),
    ];
    const replay = createReplay(events);
    expect(replay.events.map((entry) => [entry.event.seq, entry.t])).toEqual([
      [0, 0],
      [1, 100.0005],
      [2, 200],
    ]);
    expect(replay.duration).toBe(200);
    expect(replay.startMs).toBe(Date.parse(at(100)));
    expect(replay.timeOf(ulid(2))).toBe(200);
    expect(replay.timeOf('nope')).toBeUndefined();
    expect([0, 50, 100, 100.0005, 150, 200, 999].map((t) => replay.indexAt(t))).toEqual([
      1, 1, 1, 2, 2, 3, 3,
    ]);
    expect(replay.indexAt(-1)).toBe(0);
    expect(bisectTimes([1, 2, 2, 3], 2)).toBe(3);
    const sparse: number[] = [];
    sparse[0] = 1;
    sparse[2] = 3;
    expect(bisectTimes(sparse, 5)).toBe(0);
  });

  it('handles an empty run and a single instant', () => {
    const empty = createReplay([]);
    expect(empty).toMatchObject({ duration: 0, startMs: 0, events: [] });
    expect(empty.stateAt(0)).toEqual(EMPTY_WORLD);
    expect(empty.density(4)).toEqual([0, 0, 0, 0]);
    const instant = createReplay([ev(0, 5, { kind: 'error' }), ev(1, 5, { kind: 'error' })]);
    expect(instant.duration).toBe(0);
    expect(instant.density(3)).toEqual([2, 0, 0]);
    expect(instant.density(0)).toEqual([2]);
    expect(instant.stateAt(0).applied).toBe(2);
  });

  it('reduces world state through snapshots identically to a full fold', () => {
    const events = syntheticRun(2_000, 20);
    const replay = createReplay(events, 100);
    let expected = EMPTY_WORLD;
    for (const [index, entry] of replay.events.entries()) {
      expected = applyEvent(expected, entry.event);
      if (index % 137 === 0 || index === replay.events.length - 1) {
        expect(replay.stateAt(entry.t)).toEqual(expected);
      }
    }
    expect(replay.stateAt(-1)).toEqual(EMPTY_WORLD);
    expect(Object.keys(replay.stateAt(replay.duration).resources)).toHaveLength(20);
    expect(replay.stateAt(replay.duration).tokens['tok-0']).toMatchObject({
      holder: 'agent:worker',
      label: 'synthetic',
    });
  });

  it('seeks anywhere in a 10k-event run in under 16 ms', () => {
    const replay = createReplay(syntheticRun(10_000));
    expect(replay.events).toHaveLength(10_000);
    expect(SNAPSHOT_EVERY).toBe(500);
    for (let warm = 0; warm < 20; warm += 1) replay.stateAt((warm / 20) * replay.duration);
    let seed = 7;
    let worst = 0;
    for (let round = 0; round < 300; round += 1) {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      const t = (seed / 2_147_483_648) * replay.duration;
      const started = performance.now();
      const state = replay.stateAt(t);
      worst = Math.max(worst, performance.now() - started);
      expect(state.applied).toBe(replay.indexAt(t));
    }
    expect(worst).toBeLessThan(16);
    const density = replay.density(120);
    expect(density).toHaveLength(120);
    expect(density.reduce((sum, n) => sum + n, 0)).toBe(10_000);
  });
});
