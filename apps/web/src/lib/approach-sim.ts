import { seededRandom } from '@debrief/reconstruct';
import type { Event, Risk, Run } from '@debrief/schema';

// Fictional systems only (CLAUDE.md): the Orbital PaaS and a few made-up neighbours.
export const SIM_SYSTEMS = [
  'orbital',
  'orbital-mcp',
  'ledger',
  'vault',
  'relay',
  'atlas',
  'beacon',
  'harbor',
] as const;
export const SIM_PRINCIPALS = 6;
const BASE_TS = Date.UTC(2026, 8, 17);
const ZERO = '0'.repeat(64);

export interface SimulationOptions {
  moveShare?: number;
  criticalEveryMs?: number;
}

export interface Simulation {
  readonly runs: readonly Run[];
  tick(now: number): Event[];
}

// A fleet of `count` agents for the perf probe: every tick a share of them turn to another system, and a critical call lands on the cadence.
export function createSimulation(
  count: number,
  seed = 'simulation',
  { moveShare = 0.01, criticalEveryMs = 900 }: SimulationOptions = {},
): Simulation {
  const random = seededRandom(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const risks: readonly Risk[] = ['low', 'low', 'low', 'medium'];
  let seq = 0;
  let started = false;
  let lastCritical = Number.NEGATIVE_INFINITY;
  const runs: Run[] = Array.from({ length: count }, (_, index) => ({
    id: `sim-${String(index).padStart(5, '0')}`,
    tenantId: 'sim',
    principalId: `human:pilot-${String(index % SIM_PRINCIPALS)}`,
    agentName: `fleet-agent-${String(index)}`,
    startedAt: new Date(BASE_TS).toISOString(),
    eventCount: 0,
    status: 'active',
    divergenceCount: 0,
    graphVersion: 1,
  }));
  const call = (run: Run, now: number, risk: Risk, system: string): Event => {
    seq += 1;
    return {
      id: `sim-${String(seq)}`,
      tenantId: 'sim',
      seq,
      ts: new Date(BASE_TS + now).toISOString(),
      sourceTs: new Date(BASE_TS + now).toISOString(),
      source: 'mcp-proxy',
      provenance: 'reported',
      runId: run.id,
      kind: 'tool.call',
      actor: { type: 'agent', id: run.agentName, name: run.agentName },
      authority: { principalId: run.principalId },
      target: { system, operation: risk === 'critical' ? 'deleteVolume' : 'listVolumes', risk },
      attrs: {},
      summary: `${run.agentName} → ${system}`,
      prevHash: ZERO,
      hash: ZERO,
    };
  };
  return {
    runs,
    tick: (now) => {
      const events: Event[] = [];
      if (!started) {
        started = true;
        for (const run of runs) events.push(call(run, now, pick(risks), pick(SIM_SYSTEMS)));
        lastCritical = now;
        return events;
      }
      const movers = Math.round(count * moveShare);
      for (let index = 0; index < movers; index += 1) {
        events.push(call(pick(runs), now, pick(risks), pick(SIM_SYSTEMS)));
      }
      if (now - lastCritical >= criticalEveryMs && runs.length > 0) {
        lastCritical = now;
        events.push(call(pick(runs), now, 'critical', pick(SIM_SYSTEMS)));
      }
      return events;
    },
  };
}
