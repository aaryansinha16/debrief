import { COLORS } from '@debrief/ui';
import { describe, expect, it } from 'vitest';

import { liveEvent as event, liveRun as run } from './__fixtures__/live';
import { IDLE_MS, PULSE_MS, createApproachStore, laneOffset } from './approach';
import {
  AgentField,
  FADE_MS,
  FAR,
  FLIGHT_MS,
  TRAIL,
  TRAIL_MS,
  ZoneField,
  agentColor,
  read,
} from './approach-field';
import { hexToRgb } from './scene';

const at = (field: AgentField, slot: number): [number, number, number] => [
  field.positions[slot * 3]!,
  field.positions[slot * 3 + 1]!,
  field.positions[slot * 3 + 2]!,
];

// Positions and colours live in Float32Arrays; the expectations are computed in doubles.
const expectVec = (actual: ArrayLike<number>, expected: ArrayLike<number>): void => {
  expect(actual).toHaveLength(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    expect(actual[index]).toBeCloseTo(expected[index]!, 3);
  }
};

describe('AgentField', () => {
  it('spawns a new agent at its principal and flies it to its lane beside the zone', () => {
    const store = createApproachStore('field');
    store.getState().seedRuns([run('run-a')]);
    store.getState().ingest([event({ runId: 'run-a', target: { system: 'orbital' } })], 1000);
    const state = store.getState();
    const field = new AgentField(8, 'field');
    field.sync(state, 1000);
    expect(field.count).toBe(1);
    expect(field.runIdAt(0)).toBe('run-a');
    expect(field.runIdAt(1)).toBeUndefined();
    const principal = state.principals.get('human:aaryan')!;
    expectVec(at(field, 0), principal);
    expect(field.step(1000)).toBe(true);
    expectVec(at(field, 0), principal);
    field.step(1000 + FLIGHT_MS / 2);
    const midway = at(field, 0);
    expect(midway[2]).toBeGreaterThan(5);
    expect(field.step(1000 + FLIGHT_MS)).toBe(false);
    const place = state.places.get('orbital')!;
    const lane = laneOffset('run-a', 'field');
    expectVec(at(field, 0), [place[0] + lane[0], place[1] + lane[1], lane[2]]);
    expect(field.step(9999)).toBe(false);
    expectVec(field.leashEnds.subarray(0, 3), principal);
    expect(field.leashEnds[3]).toBe(FAR);
    expect(field.positions[3]).toBe(FAR);
    expect(field.dims[0]).toBe(0);
    expect(field.sizes[0]).toBe(3);
    expectVec(field.colors.subarray(0, 3), hexToRgb(COLORS.cyan));
  });

  it('samples the trail every TRAIL_MS while in flight and ages it out afterwards', () => {
    const store = createApproachStore('field');
    store.getState().ingest([event({ runId: 'run-a', target: { system: 'orbital' } })], 0);
    const field = new AgentField(4, 'field');
    field.sync(store.getState(), 0);
    field.step(0);
    expect(field.trailAge[0]).toBeCloseTo(1 - 0);
    field.step(TRAIL_MS - 1);
    const sampled = [...field.trailAge.subarray(0, TRAIL)].filter((age) => age < 1).length;
    expect(sampled).toBe(1);
    for (let tick = 1; tick <= TRAIL + 2; tick += 1) field.step(tick * TRAIL_MS);
    const ages = [...field.trailAge.subarray(0, TRAIL)];
    expect(ages.every((age) => age < 1)).toBe(true);
    expect(field.trail.subarray(0, TRAIL * 3).every((value) => value < FAR)).toBe(true);
    field.step(FLIGHT_MS + TRAIL * TRAIL_MS * 2);
    expect([...field.trailAge.subarray(0, TRAIL)]).toEqual(new Array<number>(TRAIL).fill(1));
    expect(field.trailAge[TRAIL]).toBe(1);
    expect(field.trail[TRAIL * 3]).toBe(FAR);
  });

  it('re-targets from where it is when the agent turns to another system, and fades when idle', () => {
    const store = createApproachStore('field');
    store.getState().ingest([event({ runId: 'run-a', target: { system: 'orbital' } })], 0);
    const field = new AgentField(4, 'field');
    field.sync(store.getState(), 0);
    field.step(FLIGHT_MS / 2);
    const midway = at(field, 0);
    store
      .getState()
      .ingest([event({ runId: 'run-a', target: { system: 'vault', risk: 'critical' } })], 800);
    field.sync(store.getState(), 800);
    field.sync(store.getState(), 800);
    expect(field.step(800)).toBe(true);
    expect(at(field, 0)).toEqual(midway);
    expect(field.sizes[0]).toBe(4);
    expectVec(field.colors.subarray(0, 3), hexToRgb(COLORS.ember));
    field.step(800 + FLIGHT_MS);
    const place = store.getState().places.get('vault')!;
    const lane = laneOffset('run-a', 'field');
    expectVec(at(field, 0), [place[0] + lane[0], place[1] + lane[1], lane[2]]);
    field.step(800 + IDLE_MS);
    expect(field.dims[0]).toBe(0);
    field.step(800 + IDLE_MS + FADE_MS / 2);
    expect(field.dims[0]).toBeCloseTo(0.5);
    field.step(800 + IDLE_MS + FADE_MS);
    expect(field.dims[0]).toBe(1);
  });

  it('holds an agent without a zone above its principal, or mid-stage without one, and never exceeds capacity', () => {
    const store = createApproachStore('field');
    store.getState().seedRuns([run('seeded', { status: 'ended' })]);
    store.getState().ingest([event({ runId: 'orphan', actor: { type: 'system', id: 'cron' } })], 0);
    store.getState().ingest([event({ runId: 'third' })], 0);
    const field = new AgentField(2, 'field');
    field.sync(store.getState(), 0);
    expect(field.count).toBe(2);
    field.step(FLIGHT_MS);
    const principal = store.getState().principals.get('human:aaryan')!;
    const lane = laneOffset('seeded', 'field');
    expectVec(at(field, 0), [
      principal[0] + lane[0] * 0.5,
      principal[1] + 18 + lane[1] * 0.5,
      lane[2],
    ]);
    expect(field.dims[0]).toBe(1);
    const orphanLane = laneOffset('orphan', 'field');
    expectVec(at(field, 1), [orphanLane[0] * 2, -40 + orphanLane[1] * 2, orphanLane[2]]);
    expect(field.leashEnds[3]).toBe(FAR);
    expect(field.runIdAt(2)).toBeUndefined();
  });

  it('compacts slots when an agent leaves so the others keep their position and trail', () => {
    const store = createApproachStore('field');
    store
      .getState()
      .ingest(
        [
          event({ runId: 'first', target: { system: 'orbital' } }),
          event({ runId: 'second', target: { system: 'vault' } }),
        ],
        0,
      );
    const field = new AgentField(4, 'field');
    field.sync(store.getState(), 0);
    field.step(FLIGHT_MS / 3);
    field.step((FLIGHT_MS * 2) / 3);
    const secondAt = at(field, 1);
    const secondTrail = [...field.trail.subarray(TRAIL * 3, TRAIL * 6)];
    const secondHead = field.trailAge[TRAIL];
    const agents = new Map(store.getState().agents);
    agents.delete('first');
    store.setState({ agents, version: store.getState().version + 1 });
    field.sync(store.getState(), (FLIGHT_MS * 2) / 3);
    expect(field.count).toBe(1);
    expect(field.runIdAt(0)).toBe('second');
    expect(at(field, 0)).toEqual(secondAt);
    expect([...field.trail.subarray(0, TRAIL * 3)]).toEqual(secondTrail);
    field.step((FLIGHT_MS * 2) / 3);
    expect(field.trailAge[0]).toBe(secondHead);
    expect(field.positions[3]).toBe(FAR);
    expect(field.trail[TRAIL * 3]).toBe(FAR);
    field.step(FLIGHT_MS * 2);
    const place = store.getState().places.get('vault')!;
    const lane = laneOffset('second', 'field');
    expectVec(at(field, 0), [place[0] + lane[0], place[1] + lane[1], lane[2]]);
  });

  it('reads typed arrays with a zero past the end', () => {
    expect(read(new Float32Array([1.5]), 0)).toBe(1.5);
    expect(read(new Float32Array([1.5]), 1)).toBe(0);
  });

  it('colours agents by their highest risk', () => {
    const base = { runId: 'r', agentName: 'a', events: 0, status: 'active' as const };
    expect(agentColor(base)).toEqual(hexToRgb(COLORS.cyan));
    expect(agentColor({ ...base, risk: 'low' })).toEqual(hexToRgb(COLORS.cyan));
    expect(agentColor({ ...base, risk: 'medium' })).toEqual(hexToRgb(COLORS.text));
    expect(agentColor({ ...base, risk: 'high' })).toEqual(hexToRgb(COLORS.emberDim));
    expect(agentColor({ ...base, risk: 'critical' })).toEqual(hexToRgb(COLORS.ember));
  });
});

describe('ZoneField', () => {
  it('places slabs on their slots, eases them when the arc re-spreads and reports pulses', () => {
    const store = createApproachStore('field');
    store.getState().ingest([event({ runId: 'r', target: { system: 'orbital' } })], 0);
    const zones = new ZoneField();
    zones.sync(store.getState(), 0);
    zones.sync(store.getState(), 0);
    expect(zones.slots).toHaveLength(1);
    expect(zones.slots[0]).toMatchObject({
      name: 'orbital',
      position: store.getState().places.get('orbital'),
      riskRank: -1,
      events: 1,
      pulseStrength: 0,
    });
    expect(zones.step(0, PULSE_MS)).toBe(false);
    const solo = store.getState().places.get('orbital')!;
    store
      .getState()
      .ingest([event({ runId: 'r', target: { system: 'vault', risk: 'critical' } })], 1000);
    zones.sync(store.getState(), 1000);
    expect(zones.slots).toHaveLength(2);
    expect(zones.step(1000, PULSE_MS)).toBe(true);
    expect(zones.slots[0]?.position).toEqual(solo);
    zones.step(1000 + FLIGHT_MS, PULSE_MS);
    expect(zones.slots[0]?.position).toEqual(store.getState().places.get('orbital'));
    expect(zones.slots[1]).toMatchObject({
      name: 'vault',
      pulseAt: 1000,
      pulseStrength: 1,
      riskRank: 3,
    });
    expect(zones.step(1000 + FLIGHT_MS, PULSE_MS)).toBe(false);
    expect(zones.step(1000 + PULSE_MS - 1, PULSE_MS)).toBe(true);
    expect(zones.positionOf('nowhere', 0)).toEqual([0, 0, 0]);
    store.getState().ingest([event({ runId: 'r', target: { system: 'vault' } })], 5000);
    zones.sync(store.getState(), 5000);
    expect(zones.step(5000 + PULSE_MS, PULSE_MS)).toBe(false);
    expect(zones.slots[1]?.position).toEqual(store.getState().places.get('vault'));
    store.setState({ places: new Map(), version: store.getState().version + 1 });
    zones.sync(store.getState(), 6000);
    expect(zones.step(6000, PULSE_MS)).toBe(true);
    zones.step(6000 + FLIGHT_MS, PULSE_MS);
    expect(zones.slots.map((slot) => slot.position)).toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ]);
  });
});
