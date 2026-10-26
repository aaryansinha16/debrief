import {
  type CausalGraph,
  type LinkReason,
  type WorldLink,
  correlateWorld,
  sameSystem,
} from '@debrief/reconstruct';
import type { Event } from '@debrief/schema';

import { isHuman, isLocalGitState, observedIn, summaryOf, tokenIn } from './select.js';
import type { ClaimRecord, Window } from './types.js';

export interface SideEffect {
  worldEventId: string;
  toolNodeId: string;
  toolEventIds: string[];
  confidence: 'exact' | 'strong';
  reason: LinkReason;
  system: string;
  summary: string;
}

export type WeakLink = Omit<SideEffect, 'confidence'> & { confidence: 'weak' };
export type Covered = SideEffect & { claimId: string };

export interface SideEffects {
  effects: SideEffect[];
  weak: WeakLink[];
  covered: Covered[];
}

// An asserted claim covers a change on exactly its system, in its environment and on its resource when it named them.
export function covers(claim: ClaimRecord, event: Event): boolean {
  const { system, environment, resource } = claim.subject;
  const target = event.target;
  if (claim.modality !== 'asserted' || system === 'unknown' || target?.system !== system) {
    return false;
  }
  if (
    environment !== undefined &&
    environment !== 'unknown' &&
    target.environment !== environment
  ) {
    return false;
  }
  return resource === undefined || tokenIn(resource, target.resource ?? '');
}

const GENERIC_SYSTEMS = new Set(['tool', 'extension', 'function', 'mcp']);

const toolEventIds = (graph: CausalGraph, toolNodeId: string): string[] =>
  graph.nodes
    .filter((node) => node.id === toolNodeId)
    .flatMap((node) => node.eventIds)
    .sort();

// An operation-name match alone is strong for §8; here it counts only when the tool worked on that system.
const toolSystems = (
  graph: CausalGraph,
  toolNodeId: string,
  byId: ReadonlyMap<string, Event>,
): string[] =>
  toolEventIds(graph, toolNodeId)
    .map((id) => byId.get(id)?.target?.system)
    .filter((system): system is string => system !== undefined && !GENERIC_SYSTEMS.has(system));

// A human actor on the record is not the session's, unless a traceparent or request key proves the call caused it.
const someoneElse = (event: Event, link: WorldLink): boolean =>
  isHuman(event) && link.confidence !== 'exact';

// ARCHITECTURE §18.5: observed changes the session's tool calls caused, that the agent never mentioned.
export function sideEffects(
  claims: readonly ClaimRecord[],
  events: readonly Event[],
  graph: CausalGraph,
  window: Window,
): SideEffects {
  const byId = new Map(events.map((event) => [event.id, event]));
  const links = new Map<string, WorldLink>();
  for (const link of correlateWorld(events, graph)) links.set(link.worldEventId, link);
  const result: SideEffects = { effects: [], weak: [], covered: [] };
  for (const event of observedIn(events, window)) {
    const link = links.get(event.id);
    if (
      link === undefined ||
      event.kind !== 'world.change' ||
      someoneElse(event, link) ||
      isLocalGitState(event)
    ) {
      continue;
    }
    const system = event.target?.system ?? 'unknown';
    const onSystem = toolSystems(graph, link.toolNodeId, byId).some((s) => sameSystem(s, system));
    const confidence = link.reason === 'operation' && !onSystem ? 'weak' : link.confidence;
    const entry = {
      worldEventId: event.id,
      toolNodeId: link.toolNodeId,
      toolEventIds: toolEventIds(graph, link.toolNodeId),
      reason: link.reason,
      system,
      summary: summaryOf(event),
    };
    if (confidence === 'weak') {
      result.weak.push({ ...entry, confidence: 'weak' });
      continue;
    }
    const claim = claims.find((candidate) => covers(candidate, event));
    if (claim === undefined) result.effects.push({ ...entry, confidence });
    else result.covered.push({ ...entry, confidence, claimId: claim.id });
  }
  return result;
}
