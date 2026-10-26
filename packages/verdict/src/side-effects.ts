import {
  type CausalGraph,
  type LinkReason,
  type WorldLink,
  correlateWorld,
} from '@debrief/reconstruct';
import { type Event, sortTimeline } from '@debrief/schema';

import { isLocalGitState, observedIn, onSubject, summaryOf, tokenIn } from './select.js';
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

export interface SideEffects {
  effects: SideEffect[];
  weak: WeakLink[];
}

// An asserted claim covers a change on its system, in its environment and on its resource when it named them.
export function covers(claim: ClaimRecord, event: Event): boolean {
  if (claim.modality !== 'asserted' || onSubject(claim, [event]).length === 0) return false;
  const { environment, resource } = claim.subject;
  const target = event.target;
  if (
    environment !== undefined &&
    environment !== 'unknown' &&
    target?.environment !== environment
  ) {
    return false;
  }
  return resource === undefined || tokenIn(resource, target?.resource ?? '');
}

// ARCHITECTURE §18.5: observed changes the session's tool calls caused, that the agent never mentioned.
export function sideEffects(
  claims: readonly ClaimRecord[],
  events: readonly Event[],
  graph: CausalGraph,
  window?: Window,
): SideEffects {
  const observed = window === undefined ? sortTimeline(events) : observedIn(events, window);
  const links = new Map<string, WorldLink>();
  for (const link of correlateWorld(events, graph)) links.set(link.worldEventId, link);
  const result: SideEffects = { effects: [], weak: [] };
  for (const event of observed) {
    const link = links.get(event.id);
    if (
      link === undefined ||
      event.provenance !== 'observed' ||
      event.kind !== 'world.change' ||
      isLocalGitState(event) ||
      claims.some((claim) => covers(claim, event))
    ) {
      continue;
    }
    const entry = {
      worldEventId: event.id,
      toolNodeId: link.toolNodeId,
      toolEventIds: graph.nodes
        .filter((node) => node.id === link.toolNodeId)
        .flatMap((node) => node.eventIds)
        .sort(),
      reason: link.reason,
      system: event.target?.system ?? 'unknown',
      summary: summaryOf(event),
    };
    if (link.confidence === 'weak') result.weak.push({ ...entry, confidence: 'weak' });
    else result.effects.push({ ...entry, confidence: link.confidence });
  }
  return result;
}
