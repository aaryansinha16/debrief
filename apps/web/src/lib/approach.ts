import { hashSeed } from '@debrief/reconstruct';
import type { Event, Risk, Run } from '@debrief/schema';
import { type StoreApi, createStore } from 'zustand/vanilla';

export type Vec3 = readonly [number, number, number];

export const RISK_RANK: Record<Risk, number> = { low: 0, medium: 1, high: 2, critical: 3 };
export const PULSE_MS = 1400;
export const IDLE_MS = 20_000;
export const MAX_AGENTS = 10_000;

export interface Zone {
  name: string;
  riskMax?: Risk;
  events: number;
  pulseAt?: number;
  pulseStrength: number;
}

export interface Agent {
  runId: string;
  agentName: string;
  principalId?: string;
  system?: string;
  risk?: Risk;
  events: number;
  lastSeq?: number;
  lastAt?: number;
  lastEventId?: string;
  summary?: string;
  status: Run['status'];
}

export interface Pulse {
  system: string;
  at: number;
  seq: number;
  risk: Risk;
}

export type Connection = 'connecting' | 'live' | 'offline' | 'simulated';

export interface ApproachState {
  seed: string;
  version: number;
  zones: ReadonlyMap<string, Zone>;
  places: ReadonlyMap<string, Vec3>;
  agents: ReadonlyMap<string, Agent>;
  principals: ReadonlyMap<string, Vec3>;
  head: number;
  received: number;
  critical: number;
  connection: Connection;
  lastPulse?: Pulse;
  seedRuns(runs: readonly Run[]): void;
  ingest(events: readonly Event[], now: number): void;
  setConnection(connection: Connection): void;
}

const unit = (key: string, seed: string): number => hashSeed(`${seed}:${key}`) / 4_294_967_296;

// ARCHITECTURE §11 "placed by the seeded layout": a set of names always lands on the same evenly spaced slots; the seed rotates the order.
function slots(names: readonly string[], seed: string, key: string): string[] {
  const sorted = [...names].sort();
  const turn = sorted.length === 0 ? 0 : Math.floor(unit(key, seed) * sorted.length);
  return [...sorted.slice(turn), ...sorted.slice(0, turn)];
}

// Systems sit on an arc facing the principals' row.
export function zonePositions(names: readonly string[], seed: string): Map<string, Vec3> {
  const ordered = slots(names, seed, 'zones');
  const span = ordered.length <= 1 ? 0 : 0.64;
  return new Map(
    ordered.map((name, index) => {
      const share = ordered.length <= 1 ? 0.5 : index / (ordered.length - 1);
      const angle = Math.PI * (0.5 - span / 2 + span * share);
      return [name, [Math.cos(angle) * 130, -50 + Math.sin(angle) * 120, 0]];
    }),
  );
}

export function principalPositions(ids: readonly string[], seed: string): Map<string, Vec3> {
  const ordered = slots(ids, seed, 'principals');
  return new Map(
    ordered.map((id, index) => {
      const share = ordered.length <= 1 ? 0.5 : index / (ordered.length - 1);
      return [id, [-110 + 220 * share, -95, 0]];
    }),
  );
}

// Each agent keeps its own lane around a zone, so a crowd reads as a cloud rather than one dot.
export function laneOffset(runId: string, seed: string): Vec3 {
  const angle = 2 * Math.PI * unit(`lane:${runId}`, seed);
  const radius = 8 + 12 * unit(`lane-r:${runId}`, seed);
  return [
    Math.cos(angle) * radius,
    Math.sin(angle) * radius,
    5 + 5 * unit(`lane-z:${runId}`, seed),
  ];
}

export const shortId = (id: string): string => id.slice(0, 8);

export const maxRisk = (a: Risk | undefined, b: Risk | undefined): Risk | undefined => {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return RISK_RANK[b] > RISK_RANK[a] ? b : a;
};

export const isIdle = (agent: Agent, now: number): boolean =>
  agent.status === 'ended' || agent.lastAt === undefined || now - agent.lastAt > IDLE_MS;

const principalOf = (event: Event): string | undefined =>
  event.authority?.principalId ?? (event.actor.type === 'human' ? event.actor.id : undefined);

// A new principal or zone re-spreads the row or the arc; the field eases everything to its new slot.
const withPrincipal = (
  principals: ReadonlyMap<string, Vec3>,
  id: string,
  seed: string,
): ReadonlyMap<string, Vec3> =>
  principals.has(id) ? principals : principalPositions([...principals.keys(), id], seed);

// The oldest idle agents make room first; an active agent is never evicted.
function evict(agents: Map<string, Agent>, now: number): void {
  if (agents.size <= MAX_AGENTS) return;
  const idle = [...agents.values()]
    .filter((agent) => isIdle(agent, now))
    .sort((a, b) => (a.lastAt ?? -1) - (b.lastAt ?? -1));
  for (const agent of idle) {
    if (agents.size <= MAX_AGENTS) break;
    agents.delete(agent.runId);
  }
}

// SSE feed → zustand (§11): one run is one agent, one target system is one zone, a critical event pulses its zone at once.
export function createApproachStore(seed = 'approach'): StoreApi<ApproachState> {
  return createStore<ApproachState>((set) => ({
    seed,
    version: 0,
    zones: new Map(),
    places: new Map(),
    agents: new Map(),
    principals: new Map(),
    head: -1,
    received: 0,
    critical: 0,
    connection: 'connecting',
    seedRuns: (runs) => {
      set((state) => {
        const agents = new Map(state.agents);
        let { principals } = state;
        for (const run of runs) {
          if (agents.has(run.id)) continue;
          principals = withPrincipal(principals, run.principalId, seed);
          const agent: Agent = {
            runId: run.id,
            agentName: run.agentName === '' ? shortId(run.id) : run.agentName,
            principalId: run.principalId,
            events: run.eventCount,
            status: run.status,
          };
          if (run.riskMax !== undefined) agent.risk = run.riskMax;
          agents.set(run.id, agent);
        }
        return { agents, principals, version: state.version + 1 };
      });
    },
    ingest: (events, now) => {
      if (events.length === 0) return;
      set((state) => {
        const zones = new Map(state.zones);
        const agents = new Map(state.agents);
        let { places, principals, head, received, critical, lastPulse } = state;
        for (const event of events) {
          const previous = agents.get(event.runId);
          const agent: Agent = previous
            ? { ...previous }
            : { runId: event.runId, agentName: shortId(event.runId), events: 0, status: 'active' };
          if (
            (event.actor.type === 'agent' || event.actor.type === 'subagent') &&
            agent.agentName === shortId(event.runId)
          ) {
            agent.agentName = event.actor.name ?? event.actor.id;
          }
          const principalId = agent.principalId ?? principalOf(event);
          if (principalId !== undefined) {
            agent.principalId = principalId;
            principals = withPrincipal(principals, principalId, seed);
          }
          const target = event.target;
          if (target !== undefined) {
            const known = zones.get(target.system);
            const zone: Zone = known
              ? { ...known }
              : { name: target.system, events: 0, pulseStrength: 0 };
            zones.set(target.system, zone);
            if (known === undefined) places = zonePositions([...zones.keys()], seed);
            zone.events += 1;
            agent.system = target.system;
            const risk = target.risk;
            if (risk !== undefined) {
              zone.riskMax = maxRisk(zone.riskMax, risk);
              agent.risk = maxRisk(agent.risk, risk);
              if (risk === 'critical' || risk === 'high') {
                zone.pulseAt = now;
                zone.pulseStrength = risk === 'critical' ? 1 : 0.5;
                lastPulse = { system: target.system, at: now, seq: event.seq, risk };
                if (risk === 'critical') critical += 1;
              }
            }
          }
          agent.events += 1;
          agent.lastSeq = event.seq;
          agent.lastAt = now;
          agent.lastEventId = event.id;
          agent.status = 'active';
          if (event.summary !== undefined) agent.summary = event.summary;
          agents.set(event.runId, agent);
          head = Math.max(head, event.seq);
          received += 1;
        }
        evict(agents, now);
        const next: Partial<ApproachState> = {
          zones,
          places,
          agents,
          principals,
          head,
          received,
          critical,
          version: state.version + 1,
        };
        if (lastPulse !== undefined) next.lastPulse = lastPulse;
        return next;
      });
    },
    setConnection: (connection) => {
      set({ connection });
    },
  }));
}
