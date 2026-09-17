import { COLORS } from '@debrief/ui';

import { type Agent, type ApproachState, IDLE_MS, type Vec3, laneOffset } from './approach';
import { hexToRgb } from './scene';

export const TRAIL = 8;
export const TRAIL_MS = 90;
export const FLIGHT_MS = 1600;
export const FADE_MS = 5000;
export const LOD_AGENT_THRESHOLD = 1000;
// Off-stage: clipped by the frustum, so an unused slot costs no fragments.
export const FAR = 1e6;

const EMBER = hexToRgb(COLORS.ember);
const EMBER_DIM = hexToRgb(COLORS.emberDim);
const CYAN = hexToRgb(COLORS.cyan);
const TEXT = hexToRgb(COLORS.text);

const smoothstep = (p: number): number => p * p * (3 - 2 * p);
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
// Typed arrays read as `number | undefined` under noUncheckedIndexedAccess; every in-range read goes through here.
export const read = (array: ArrayLike<number>, index: number): number => array[index] ?? 0;

export const agentColor = (agent: Agent): [number, number, number] => {
  if (agent.risk === 'critical') return EMBER;
  if (agent.risk === 'high') return EMBER_DIM;
  if (agent.risk === 'medium') return TEXT;
  return CYAN;
};

interface Slot {
  runId: string;
  key: string;
  start: Vec3;
  target: Vec3;
  startAt: number;
  lastAt: number | undefined;
  ended: boolean;
  principal: Vec3 | undefined;
}

// Where an agent is heading: its lane beside the zone it last touched, a holding spot above its principal, or the middle.
function targetOf(agent: Agent, state: ApproachState, lane: Vec3): { key: string; at: Vec3 } {
  const { system, principalId } = agent;
  const place = system === undefined ? undefined : state.places.get(system);
  if (system !== undefined && place !== undefined) {
    return { key: `zone:${system}`, at: [place[0] + lane[0], place[1] + lane[1], lane[2]] };
  }
  const principal = principalId === undefined ? undefined : state.principals.get(principalId);
  if (principalId !== undefined && principal !== undefined) {
    return {
      key: `principal:${principalId}`,
      at: [principal[0] + lane[0] * 0.5, principal[1] + 18 + lane[1] * 0.5, lane[2]],
    };
  }
  return { key: 'nowhere', at: [lane[0] * 2, -40 + lane[1] * 2, lane[2]] };
}

// Per-agent motion in typed arrays: the store says where each agent is heading, the field says where it is this frame.
export class AgentField {
  count = 0;
  version = -1;
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly sizes: Float32Array;
  readonly dims: Float32Array;
  readonly trail: Float32Array;
  readonly trailAge: Float32Array;
  readonly leashEnds: Float32Array;
  private readonly slots: Slot[] = [];
  private readonly trailAt: Float64Array;
  private readonly trailHead: Uint8Array;
  private readonly sampledAt: Float64Array;

  constructor(
    readonly capacity: number,
    private readonly seed: string,
  ) {
    this.positions = new Float32Array(capacity * 3).fill(FAR);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.dims = new Float32Array(capacity);
    this.trail = new Float32Array(capacity * TRAIL * 3).fill(FAR);
    this.trailAge = new Float32Array(capacity * TRAIL).fill(1);
    this.leashEnds = new Float32Array(capacity * 3).fill(FAR);
    this.trailAt = new Float64Array(capacity * TRAIL).fill(Number.NEGATIVE_INFINITY);
    this.trailHead = new Uint8Array(capacity);
    this.sampledAt = new Float64Array(capacity).fill(Number.NEGATIVE_INFINITY);
  }

  runIdAt(slot: number): string | undefined {
    return this.slots[slot]?.runId;
  }

  // Slots follow the store's order; an evicted agent's slot is compacted away and the rest shift with their motion state.
  sync(state: ApproachState, now: number): void {
    if (state.version === this.version) return;
    this.version = state.version;
    const agents = [...state.agents.values()].slice(0, this.capacity);
    const before = new Map(this.slots.map((slot, index) => [slot.runId, index]));
    const positions = this.positions.slice();
    const trail = this.trail.slice();
    const trailAt = this.trailAt.slice();
    const trailHead = this.trailHead.slice();
    const sampledAt = this.sampledAt.slice();
    const slots: Slot[] = [];
    agents.forEach((agent, index) => {
      const lane = laneOffset(agent.runId, this.seed);
      const { key, at } = targetOf(agent, state, lane);
      const principal =
        agent.principalId === undefined ? undefined : state.principals.get(agent.principalId);
      const previousIndex = before.get(agent.runId);
      const previous = previousIndex === undefined ? undefined : this.slots[previousIndex];
      if (previous !== undefined && previousIndex !== undefined && previousIndex !== index) {
        this.positions.set(positions.subarray(previousIndex * 3, previousIndex * 3 + 3), index * 3);
        this.trail.set(
          trail.subarray(previousIndex * TRAIL * 3, (previousIndex + 1) * TRAIL * 3),
          index * TRAIL * 3,
        );
        this.trailAt.set(
          trailAt.subarray(previousIndex * TRAIL, (previousIndex + 1) * TRAIL),
          index * TRAIL,
        );
        this.trailHead[index] = read(trailHead, previousIndex);
        this.sampledAt[index] = read(sampledAt, previousIndex);
      }
      const moved = previous?.key !== key;
      const current: Vec3 =
        previous === undefined
          ? (principal ?? at)
          : [
              read(this.positions, index * 3),
              read(this.positions, index * 3 + 1),
              read(this.positions, index * 3 + 2),
            ];
      if (previous === undefined) {
        this.positions.set(current, index * 3);
        this.trail.fill(FAR, index * TRAIL * 3, (index + 1) * TRAIL * 3);
        this.trailAt.fill(Number.NEGATIVE_INFINITY, index * TRAIL, (index + 1) * TRAIL);
        this.trailHead[index] = 0;
        this.sampledAt[index] = Number.NEGATIVE_INFINITY;
      }
      slots.push({
        runId: agent.runId,
        key,
        start: moved ? current : previous.start,
        target: moved ? at : previous.target,
        startAt: moved ? now : previous.startAt,
        lastAt: agent.lastAt,
        ended: agent.status === 'ended',
        principal,
      });
      this.colors.set(agentColor(agent), index * 3);
      this.sizes[index] = agent.risk === 'critical' ? 4 : 3;
    });
    this.slots.length = 0;
    this.slots.push(...slots);
    this.count = slots.length;
    this.positions.fill(FAR, this.count * 3);
    this.leashEnds.fill(FAR, this.count * 3);
    this.trail.fill(FAR, this.count * TRAIL * 3);
    this.trailAge.fill(1, this.count * TRAIL);
  }

  // Advances every agent along its flight and samples the trail; true while anything is still in motion.
  step(now: number): boolean {
    let moving = false;
    this.slots.forEach((slot, index) => {
      const p = clamp01((now - slot.startAt) / FLIGHT_MS);
      const e = smoothstep(p);
      const at = index * 3;
      // Lands exactly on the target: the eased sum can miss it by a bit.
      if (p >= 1) this.positions.set(slot.target, at);
      else {
        this.positions[at] = slot.start[0] + (slot.target[0] - slot.start[0]) * e;
        this.positions[at + 1] = slot.start[1] + (slot.target[1] - slot.start[1]) * e;
        this.positions[at + 2] =
          slot.start[2] + (slot.target[2] - slot.start[2]) * e + Math.sin(p * Math.PI) * 6;
        moving = true;
      }
      const idle =
        slot.ended || slot.lastAt === undefined
          ? 1
          : clamp01((now - slot.lastAt - IDLE_MS) / FADE_MS);
      this.dims[index] = idle;
      if (slot.principal === undefined) this.leashEnds.fill(FAR, at, at + 3);
      else this.leashEnds.set(slot.principal, at);
      if (now - read(this.sampledAt, index) >= TRAIL_MS && p < 1) {
        const head = (read(this.trailHead, index) + 1) % TRAIL;
        this.trailHead[index] = head;
        this.sampledAt[index] = now;
        this.trail.set(this.positions.subarray(at, at + 3), (index * TRAIL + head) * 3);
        this.trailAt[index * TRAIL + head] = now;
      }
      for (let point = 0; point < TRAIL; point += 1) {
        const sampled = read(this.trailAt, index * TRAIL + point);
        this.trailAge[index * TRAIL + point] = clamp01((now - sampled) / (TRAIL * TRAIL_MS));
      }
    });
    return moving;
  }
}

export interface ZoneSlot {
  name: string;
  position: Vec3;
  pulseAt: number;
  pulseStrength: number;
  riskRank: number;
  events: number;
}

const RISK_RANKS = { low: 0, medium: 1, high: 2, critical: 3 } as const;

// Slabs ease to their slot when the arc re-spreads; the pulse fields are read straight from the store.
export class ZoneField {
  version = -1;
  readonly slots: ZoneSlot[] = [];
  private readonly flights = new Map<string, { start: Vec3; target: Vec3; startAt: number }>();

  sync(state: ApproachState, now: number): void {
    if (state.version === this.version) return;
    this.version = state.version;
    this.slots.length = 0;
    for (const zone of state.zones.values()) {
      const target = state.places.get(zone.name) ?? [0, 0, 0];
      const flight = this.flights.get(zone.name);
      if (flight === undefined) {
        this.flights.set(zone.name, { start: target, target, startAt: Number.NEGATIVE_INFINITY });
      } else if (flight.target.join(',') !== target.join(',')) {
        this.flights.set(zone.name, {
          start: this.positionOf(zone.name, now),
          target,
          startAt: now,
        });
      }
      this.slots.push({
        name: zone.name,
        position: target,
        pulseAt: zone.pulseAt ?? Number.NEGATIVE_INFINITY,
        pulseStrength: zone.pulseStrength,
        riskRank: zone.riskMax === undefined ? -1 : RISK_RANKS[zone.riskMax],
        events: zone.events,
      });
    }
  }

  positionOf(name: string, now: number): Vec3 {
    const flight = this.flights.get(name);
    if (flight === undefined) return [0, 0, 0];
    const p = clamp01((now - flight.startAt) / FLIGHT_MS);
    if (p >= 1) return flight.target;
    const e = smoothstep(p);
    return [
      flight.start[0] + (flight.target[0] - flight.start[0]) * e,
      flight.start[1] + (flight.target[1] - flight.start[1]) * e,
      flight.start[2] + (flight.target[2] - flight.start[2]) * e,
    ];
  }

  // True while a slab is still easing or a pulse is still visible.
  step(now: number, pulseMs: number): boolean {
    let moving = false;
    for (const slot of this.slots) {
      slot.position = this.positionOf(slot.name, now);
      const flight = this.flights.get(slot.name);
      if (flight !== undefined && now - flight.startAt < FLIGHT_MS) moving = true;
      if (now - slot.pulseAt < pulseMs) moving = true;
    }
    return moving;
  }
}
