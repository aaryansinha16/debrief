import {
  type Decision,
  type Effect,
  type Policy,
  type Subject,
  evaluateEvent,
} from '@debrief/policy';
import { type Event, type Target, scopeMismatchOf } from '@debrief/schema';

import { type HopAuthority, authorityLineage } from './lineage.js';
import { reconstructGraph } from './pipeline.js';
import { compareKeys, timelineKey } from './timeline.js';
import type { CausalGraph, GraphNode } from './types.js';

export interface DivergencePoint {
  eventId: string;
  seq: number;
  kind: Event['kind'];
  nodeId?: string;
  effect: Exclude<Effect, 'allow'>;
  ruleId?: string;
  explanation: string;
}

export interface DivergenceReport {
  runId: string;
  evaluated: number;
  points: DivergencePoint[];
  freezeFrame?: DivergencePoint;
}

const PRIMARY_KINDS = new Set<Event['kind']>(['tool.call', 'mcp.request']);

// The tool's own target overlaid with what the world observed (environment, resource, risk), plus the observed authority.
function contextFor(
  graph: CausalGraph,
  tool: GraphNode,
  events: readonly Event[],
  byId: ReadonlyMap<string, Event>,
): Subject {
  const worldEvents = graph.edges
    .filter(
      (edge) => edge.from === tool.id && (edge.type === 'mutates' || edge.type === 'observes'),
    )
    .flatMap((edge) => edge.eventIds)
    .map((id) => byId.get(id))
    .filter((event): event is Event => event?.kind === 'world.change');
  const ctx: Subject = {};
  const observed = worldEvents[0];
  if (observed?.target !== undefined) {
    const own = tool.eventIds
      .map((id) => byId.get(id)?.target)
      .find((target) => target !== undefined);
    const target: Target = { ...own, ...observed.target };
    ctx.target = target;
    const lineage = authorityLineage(graph, tool.id, events);
    const acting = lineage.authorityObserved
      ? lineage.hops
          .map((hop) => hop.authority)
          .filter((authority): authority is HopAuthority => authority !== undefined)
          .at(-1)
      : undefined;
    if (acting !== undefined) {
      const mismatch = scopeMismatchOf(
        {
          principalId: acting.principalId ?? 'unknown',
          scope: acting.scope,
          permissions: acting.permissions,
        },
        target,
      );
      ctx.authority = {
        ...acting,
        scopeMismatch: mismatch?.severity === 'major',
        scopeExcess: mismatch?.excess ?? [],
      };
    }
  }
  return ctx;
}

const isDivergent = (
  decision: Decision,
): decision is Decision & { effect: Exclude<Effect, 'allow'> } => decision.effect !== 'allow';

// ARCHITECTURE §9: actionable events are tool calls (or bare MCP calls) and world changes no call explains; the first non-allow is the freeze frame.
export function divergence(
  events: readonly Event[],
  policy: Policy,
  graph: CausalGraph = reconstructGraph(events),
): DivergenceReport {
  const byId = new Map(events.map((event) => [event.id, event]));
  const linkedWorld = new Set<string>();
  const candidates: { event: Event; nodeId?: string; ctx?: Subject }[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'tool') continue;
    for (const edge of graph.edges) {
      if (edge.from === node.id && (edge.type === 'mutates' || edge.type === 'observes')) {
        for (const id of edge.eventIds) linkedWorld.add(id);
      }
    }
    const primary = node.eventIds
      .map((id) => byId.get(id))
      .find((event) => event !== undefined && PRIMARY_KINDS.has(event.kind));
    if (primary === undefined) continue;
    candidates.push({
      event: primary,
      nodeId: node.id,
      ctx: contextFor(graph, node, events, byId),
    });
  }
  for (const event of events) {
    if (
      event.kind === 'world.change' &&
      event.runId === graph.runId &&
      !linkedWorld.has(event.id)
    ) {
      candidates.push({ event });
    }
  }
  candidates.sort((a, b) => compareKeys(timelineKey(a.event), timelineKey(b.event)));
  const points: DivergencePoint[] = [];
  for (const candidate of candidates) {
    const decision = evaluateEvent(candidate.event, policy, candidate.ctx);
    if (!isDivergent(decision)) continue;
    const point: DivergencePoint = {
      eventId: candidate.event.id,
      seq: candidate.event.seq,
      kind: candidate.event.kind,
      effect: decision.effect,
      explanation: decision.explanation,
    };
    if (candidate.nodeId !== undefined) point.nodeId = candidate.nodeId;
    if (decision.ruleId !== undefined) point.ruleId = decision.ruleId;
    points.push(point);
  }
  const report: DivergenceReport = { runId: graph.runId, evaluated: candidates.length, points };
  const [freezeFrame] = points;
  if (freezeFrame !== undefined) report.freezeFrame = freezeFrame;
  return report;
}
