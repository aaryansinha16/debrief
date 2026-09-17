import { describe, expect, it } from 'vitest';

import { createApproachStore } from './approach';
import { SIM_PRINCIPALS, SIM_SYSTEMS, createSimulation } from './approach-sim';

describe('createSimulation', () => {
  it('seeds every agent on the first tick, then moves a share and lands a critical call on the cadence', () => {
    const sim = createSimulation(200, 'test', { moveShare: 0.05, criticalEveryMs: 500 });
    expect(sim.runs).toHaveLength(200);
    expect(new Set(sim.runs.map((run) => run.principalId)).size).toBe(SIM_PRINCIPALS);
    const first = sim.tick(0);
    expect(first).toHaveLength(200);
    expect(new Set(first.map((event) => event.runId)).size).toBe(200);
    expect(first.every((event) => event.target?.risk !== 'critical')).toBe(true);
    expect(first.every((event) => SIM_SYSTEMS.includes(event.target!.system as never))).toBe(true);
    const quiet = sim.tick(100);
    expect(quiet).toHaveLength(10);
    expect(quiet.every((event) => event.target?.risk !== 'critical')).toBe(true);
    const loud = sim.tick(600);
    expect(loud).toHaveLength(11);
    expect(loud.at(-1)?.target).toMatchObject({ risk: 'critical', operation: 'deleteVolume' });
    expect(sim.tick(700).filter((event) => event.target?.risk === 'critical')).toHaveLength(0);
    expect(sim.tick(1100).filter((event) => event.target?.risk === 'critical')).toHaveLength(1);
    const seqs = [...first, ...quiet, ...loud].map((event) => event.seq);
    expect(seqs).toEqual(seqs.map((_, index) => index + 1));
    expect(loud[0]?.ts).toBe('2026-09-17T00:00:00.600Z');
  });

  it('is deterministic for a seed and feeds the store', () => {
    const a = createSimulation(50, 'same').tick(0);
    const b = createSimulation(50, 'same').tick(0);
    expect(a).toEqual(b);
    expect(a).not.toEqual(createSimulation(50, 'other').tick(0));
    const store = createApproachStore('sim');
    store.getState().seedRuns(createSimulation(50, 'same').runs);
    store.getState().ingest(a, 0);
    expect(store.getState().agents.size).toBe(50);
    expect(store.getState().zones.size).toBeGreaterThan(1);
    expect(store.getState().principals.size).toBe(SIM_PRINCIPALS);
    expect(store.getState().agents.get('sim-00007')?.agentName).toBe('fleet-agent-7');
    const empty = createSimulation(0, 'none');
    expect(empty.tick(0)).toEqual([]);
    expect(empty.tick(5000)).toEqual([]);
  });
});
