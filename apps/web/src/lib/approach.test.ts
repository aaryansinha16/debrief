import { demoRunFixture } from '@debrief/reconstruct/fixtures';
import type { Event } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import {
  IDLE_MS,
  MAX_AGENTS,
  createApproachStore,
  isIdle,
  laneOffset,
  maxRisk,
  principalPositions,
  zonePositions,
} from './approach';

import { liveEvent as event, liveRun as run } from './__fixtures__/live';

describe('placement', () => {
  it('is a pure function of the set and the seed, spreading the demo systems along the arc', () => {
    const names = ['orbital-mcp', 'extension', 'orbital'];
    expect(zonePositions(names, 's')).toEqual(zonePositions([...names].reverse(), 's'));
    expect(Object.fromEntries(zonePositions(names, 's'))).not.toEqual(
      Object.fromEntries(zonePositions(names, 'other')),
    );
    const demo = [...zonePositions(names, 'approach').values()];
    for (const [index, a] of demo.entries()) {
      for (const b of demo.slice(index + 1)) {
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(60);
      }
      expect(a[2]).toBe(0);
      expect(Math.abs(a[0])).toBeLessThanOrEqual(130);
    }
    expect([...zonePositions(['solo'], 's').values()]).toEqual([[expect.closeTo(0, 6), 70, 0]]);
    expect(zonePositions([], 's').size).toBe(0);
    const row = principalPositions(['human:aaryan', 'human:kim'], 'approach');
    expect([...row.values()].map((at) => at[1])).toEqual([-95, -95]);
    expect([...row.values()].map((at) => at[0]).sort((a, b) => a - b)).toEqual([-110, 110]);
    expect(principalPositions(['only'], 's').get('only')).toEqual([0, -95, 0]);
    const lane = laneOffset('run-1', 'approach');
    expect(Math.hypot(lane[0], lane[1])).toBeGreaterThanOrEqual(8);
    expect(Math.hypot(lane[0], lane[1])).toBeLessThanOrEqual(20);
    expect(lane[2]).toBeGreaterThanOrEqual(5);
  });

  it('ranks risk and reads idleness from the last event time', () => {
    expect(maxRisk(undefined, 'low')).toBe('low');
    expect(maxRisk('high', undefined)).toBe('high');
    expect(maxRisk('medium', 'critical')).toBe('critical');
    expect(maxRisk('critical', 'low')).toBe('critical');
    const agent = { runId: 'r', agentName: 'a', events: 1, status: 'active' as const };
    expect(isIdle(agent, 0)).toBe(true);
    expect(isIdle({ ...agent, lastAt: 1000 }, 1000 + IDLE_MS)).toBe(false);
    expect(isIdle({ ...agent, lastAt: 1000 }, 1001 + IDLE_MS)).toBe(true);
    expect(isIdle({ ...agent, lastAt: 1000, status: 'ended' }, 1000)).toBe(true);
  });
});

describe('createApproachStore', () => {
  it('turns the demo run into agents, zones and principals with the divergence pulsing its zone', () => {
    const store = createApproachStore();
    store.getState().ingest(demoRunFixture(), 5000);
    const state = store.getState();
    expect([...state.zones.keys()].sort()).toEqual(['extension', 'orbital', 'orbital-mcp']);
    expect(state.agents.size).toBe(2);
    const agent = [...state.agents.values()].find((entry) => entry.agentName === 'coding-agent')!;
    expect(agent.principalId).toBe('human:aaryan');
    expect(agent.risk).toBe('critical');
    expect(agent.summary).toBeDefined();
    expect(agent.lastAt).toBe(5000);
    expect(state.principals.get('human:aaryan')).toEqual([0, -95, 0]);
    expect(state.places).toEqual(zonePositions([...state.zones.keys()], 'approach'));
    expect(state.places.size).toBe(3);
    expect(state.zones.get('orbital')?.riskMax).toBe('critical');
    expect(state.zones.get('orbital')?.pulseAt).toBe(5000);
    expect(state.zones.get('orbital')?.pulseStrength).toBe(1);
    expect(state.lastPulse).toMatchObject({ system: 'orbital', at: 5000, risk: 'critical' });
    expect(state.critical).toBe(1);
    expect(state.received).toBe(49);
    expect(state.head).toBe(Math.max(...demoRunFixture().map((entry) => entry.seq)));
    expect(state.version).toBe(1);
  });

  it('seeds agents from the run list without moving anything, then lets events take over', () => {
    const store = createApproachStore('seed');
    store
      .getState()
      .seedRuns([
        run('run-a', { riskMax: 'high' }),
        run('run-b', { agentName: '', status: 'ended', endedAt: '2026-09-17T00:01:00Z' }),
      ]);
    store.getState().seedRuns([run('run-a', { agentName: 'ignored' })]);
    let state = store.getState();
    expect(state.agents.get('run-a')).toMatchObject({
      agentName: 'coding-agent',
      risk: 'high',
      events: 3,
      status: 'active',
    });
    expect(state.agents.get('run-b')).toMatchObject({ agentName: 'run-b', status: 'ended' });
    expect(state.agents.get('run-a')?.system).toBeUndefined();
    expect(state.zones.size).toBe(0);
    expect(state.principals.size).toBe(1);
    store.getState().ingest(
      [
        event({
          runId: 'run-b',
          actor: { type: 'subagent', id: 'sub-1', name: 'helper' },
          target: { system: 'vault', risk: 'high' },
          summary: 'reading a secret',
        }),
      ],
      100,
    );
    state = store.getState();
    expect(state.agents.get('run-b')).toMatchObject({
      agentName: 'helper',
      system: 'vault',
      risk: 'high',
      status: 'active',
      events: 4,
      summary: 'reading a secret',
      lastAt: 100,
    });
    expect(state.zones.get('vault')).toMatchObject({ pulseAt: 100, pulseStrength: 0.5 });
    expect(state.lastPulse?.risk).toBe('high');
    expect(state.critical).toBe(0);
    store.getState().ingest([], 200);
    expect(store.getState().version).toBe(3);
    store.getState().setConnection('live');
    expect(store.getState().connection).toBe('live');
  });

  it('names an unknown run from its first agent actor and its principal from a human actor', () => {
    const store = createApproachStore();
    store.getState().ingest(
      [
        event({
          runId: 'run-x',
          kind: 'principal.session',
          actor: { type: 'human', id: 'human:kim' },
        }),
        event({
          runId: 'run-x',
          actor: { type: 'agent', id: 'agent-7' },
          target: { system: 'ledger', risk: 'low' },
        }),
        event({
          runId: 'run-x',
          actor: { type: 'agent', id: 'other', name: 'later' },
          authority: { principalId: 'human:someone-else' },
          target: { system: 'ledger' },
        }),
      ],
      1,
    );
    const agent = store.getState().agents.get('run-x')!;
    expect(agent.agentName).toBe('agent-7');
    expect(agent.principalId).toBe('human:kim');
    expect(agent.risk).toBe('low');
    expect(store.getState().zones.get('ledger')).toMatchObject({ events: 2, riskMax: 'low' });
    expect(store.getState().zones.get('ledger')?.pulseAt).toBeUndefined();
    expect(store.getState().lastPulse).toBeUndefined();
  });

  it('evicts the oldest idle agents past the cap and keeps active ones', () => {
    const store = createApproachStore();
    const events: Event[] = [];
    for (let index = 0; index < MAX_AGENTS + 5; index += 1) {
      events.push(event({ runId: `run-${String(index)}` }));
    }
    store.getState().seedRuns([run('seeded'), run('seeded-too')]);
    store.getState().ingest(events.slice(0, 3), 0);
    store.getState().ingest(events.slice(3), IDLE_MS + 1);
    const state = store.getState();
    expect(state.agents.size).toBe(MAX_AGENTS + 2);
    expect(state.agents.has('seeded')).toBe(false);
    expect(state.agents.has('seeded-too')).toBe(false);
    expect(state.agents.has('run-0')).toBe(false);
    expect(state.agents.has('run-1')).toBe(false);
    expect(state.agents.has('run-2')).toBe(false);
    expect(state.agents.has('run-3')).toBe(true);
    store.getState().ingest([event({ runId: 'run-new' })], IDLE_MS + 2);
    expect(store.getState().agents.size).toBe(MAX_AGENTS + 3);
    store.getState().ingest([event({ runId: 'run-last' })], IDLE_MS * 3);
    expect(store.getState().agents.size).toBe(MAX_AGENTS);
    expect(store.getState().agents.has('run-last')).toBe(true);
  });
});
