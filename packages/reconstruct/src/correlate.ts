import type { Event } from '@debrief/schema';

import { timelineKey } from './timeline.js';
import {
  CONFIDENCE_RANK,
  type CausalGraph,
  type Confidence,
  type GraphEdge,
  type GraphNode,
} from './types.js';

export type LinkReason = 'traceparent' | 'token' | 'operation' | 'system';

export interface WorldLink {
  worldEventId: string;
  toolNodeId: string;
  confidence: Confidence;
  reason: LinkReason;
  deltaMs: number;
}

export interface CorrelationWindows {
  strongMs: number;
  weakMs: number;
}

// ARCHITECTURE §8: strong within ±2 s, weak within ±10 s.
export const DEFAULT_WINDOWS: CorrelationWindows = { strongMs: 2000, weakMs: 10_000 };

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

export function parseTraceparent(value: unknown): { traceId: string; spanId: string } | undefined {
  const match = typeof value === 'string' ? TRACEPARENT.exec(value) : null;
  if (match === null) return undefined;
  const [, traceId = '', spanId = ''] = match;
  return { traceId, spanId };
}

const GENERIC_SYSTEMS = new Set(['tool', 'extension', 'function', 'mcp']);

const millisOf = (event: Event): number => {
  const [millis, subMillis] = timelineKey(event);
  return millis + subMillis / 1_000_000;
};

const sameSystem = (a: string, b: string): boolean =>
  a === b || a.startsWith(`${b}-`) || b.startsWith(`${a}-`);

interface ToolFacts {
  node: GraphNode;
  start: number;
  end: number;
  spanIds: Set<string>;
  tokens: Set<string>;
  operations: Set<string>;
  systems: Set<string>;
}

function toolFacts(graph: CausalGraph, byId: ReadonlyMap<string, Event>): ToolFacts[] {
  const facts: ToolFacts[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'tool') continue;
    const fact: ToolFacts = {
      node,
      start: Number.POSITIVE_INFINITY,
      end: Number.NEGATIVE_INFINITY,
      spanIds: new Set(),
      tokens: new Set(),
      operations: new Set([node.label.toLowerCase()]),
      systems: new Set(),
    };
    for (const id of node.eventIds) {
      const event = byId.get(id);
      if (event === undefined) continue;
      const at = millisOf(event);
      fact.start = Math.min(fact.start, at);
      fact.end = Math.max(fact.end, at);
      if (event.spanId !== undefined) fact.spanIds.add(event.spanId);
      const own = parseTraceparent(event.attrs.traceparent);
      if (own !== undefined) fact.spanIds.add(own.spanId);
      for (const token of [event.authority?.tokenRef, event.authority?.grantId]) {
        if (token !== undefined) fact.tokens.add(token);
      }
      const operation = event.target?.operation;
      if (operation !== undefined) fact.operations.add(operation.toLowerCase());
      const system = event.target?.system;
      if (system !== undefined && !GENERIC_SYSTEMS.has(system)) fact.systems.add(system);
    }
    facts.push(fact);
  }
  return facts;
}

const distance = (at: number, fact: ToolFacts): number =>
  at < fact.start ? fact.start - at : at > fact.end ? at - fact.end : 0;

function bestLink(
  world: Event,
  facts: readonly ToolFacts[],
  windows: CorrelationWindows,
  runId: string,
): WorldLink | undefined {
  const parent = parseTraceparent(world.attrs.traceparent);
  if (parent !== undefined && parent.traceId !== runId) return undefined;
  const at = millisOf(world);
  const tokens = [world.authority?.tokenRef, world.authority?.grantId].filter(
    (token): token is string => token !== undefined,
  );
  const operation = world.target?.operation?.toLowerCase();
  const system = world.target?.system;
  let best: WorldLink | undefined;
  const consider = (candidate: WorldLink): void => {
    if (
      best === undefined ||
      CONFIDENCE_RANK[candidate.confidence] > CONFIDENCE_RANK[best.confidence] ||
      (candidate.confidence === best.confidence && candidate.deltaMs < best.deltaMs)
    ) {
      best = candidate;
    }
  };
  for (const fact of facts) {
    const deltaMs = distance(at, fact);
    const link = (confidence: Confidence, reason: LinkReason): WorldLink => ({
      worldEventId: world.id,
      toolNodeId: fact.node.id,
      confidence,
      reason,
      deltaMs,
    });
    if (parent !== undefined && fact.spanIds.has(parent.spanId)) {
      consider(link('exact', 'traceparent'));
      continue;
    }
    if (deltaMs <= windows.strongMs) {
      if (tokens.some((token) => fact.tokens.has(token))) {
        consider(link('strong', 'token'));
        continue;
      }
      if (operation !== undefined && fact.operations.has(operation)) {
        consider(link('strong', 'operation'));
        continue;
      }
    }
    if (deltaMs <= windows.weakMs && system !== undefined) {
      if ([...fact.systems].some((candidate) => sameSystem(candidate, system))) {
        consider(link('weak', 'system'));
      }
    }
  }
  return best;
}

// One link per world.change: the most confident, then the nearest, tool call of the graph's run.
export function correlateWorld(
  events: readonly Event[],
  graph: CausalGraph,
  windows: CorrelationWindows = DEFAULT_WINDOWS,
): WorldLink[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  const facts = toolFacts(graph, byId);
  const links: WorldLink[] = [];
  const worlds = events
    .filter((event) => event.kind === 'world.change')
    .sort((a, b) => a.seq - b.seq);
  for (const world of worlds) {
    const link = bestLink(world, facts, windows, graph.runId);
    if (link !== undefined) links.push(link);
  }
  return links;
}

function upsertEdge(edges: GraphEdge[], edge: GraphEdge): void {
  const existing = edges.find(
    (candidate) =>
      candidate.from === edge.from && candidate.to === edge.to && candidate.type === edge.type,
  );
  if (existing === undefined) {
    edges.push(edge);
    return;
  }
  if (CONFIDENCE_RANK[edge.confidence] > CONFIDENCE_RANK[existing.confidence]) {
    existing.confidence = edge.confidence;
  }
  for (const id of edge.eventIds) if (!existing.eventIds.includes(id)) existing.eventIds.push(id);
}

// Adds tool→resource `mutates` edges (and the authority the world saw) at the link's confidence; the P-22 graph is untouched.
export function applyWorldLinks(
  graph: CausalGraph,
  links: readonly WorldLink[],
  events: readonly Event[],
): CausalGraph {
  const byId = new Map(events.map((event) => [event.id, event]));
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const edges = graph.edges.map((edge) => ({ ...edge, eventIds: [...edge.eventIds] }));
  for (const link of links) {
    const world = byId.get(link.worldEventId);
    const target = world?.target;
    if (world === undefined || target?.resource === undefined) continue;
    const resource = `resource:${target.system}:${target.resource}`;
    if (!nodeIds.has(resource) || !nodeIds.has(link.toolNodeId)) continue;
    upsertEdge(edges, {
      from: link.toolNodeId,
      to: resource,
      type: 'mutates',
      confidence: link.confidence,
      eventIds: [world.id],
    });
    const authority = world.authority;
    if (authority === undefined) continue;
    const grant = [authority.tokenRef, authority.grantId]
      .map((ref) => (ref === undefined ? undefined : `grant:${ref}`))
      .find((id) => id !== undefined && nodeIds.has(id));
    const principal = `principal:${authority.principalId.replace(/^human:/, '')}`;
    const to = grant ?? (nodeIds.has(principal) ? principal : undefined);
    if (to !== undefined) {
      upsertEdge(edges, {
        from: link.toolNodeId,
        to,
        type: 'authorized_by',
        confidence: link.confidence,
        eventIds: [world.id],
      });
    }
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, eventIds: [...node.eventIds] })),
    edges,
  };
}
