import { readsSystem } from '@debrief/verdict';

import { CANVAS_SESSION, CANVAS_SESSION_ID } from './__fixtures__/canvas-claims';
import { ApiError, type ApiClient, createApiClient } from './api';
import type { SessionCheckApi } from './session-api';
import { type SessionCheck, buildSessionCheck } from './session-check';
import { type SessionCheckInput, sessionCheckInputSchema } from './session-check-input';

export const SAMPLE_SESSION_ID = CANVAS_SESSION_ID;

const TRUST_RANK = { local: 0, 'third-party': 1 } as const;

type Witness = SessionCheckInput['witnesses'][number];

// One entry per system at its better trust, counting only that trust; a system no witness reads is missing.
function roster(api: SessionCheckApi): Witness[] {
  const connected = new Map<string, Extract<Witness, { state: 'connected' }>>();
  for (const witness of api.witnesses) {
    const current = connected.get(witness.system);
    if (current === undefined || TRUST_RANK[witness.trust] > TRUST_RANK[current.trust]) {
      connected.set(witness.system, {
        state: 'connected',
        system: witness.system,
        trust: witness.trust,
        observed: witness.events,
      });
    } else if (witness.trust === current.trust) {
      current.observed += witness.events;
    }
  }
  const missing = new Set<string>();
  for (const claim of api.claims) {
    const system = claim.subject.system;
    const read = [...connected.keys()].some((watched) => readsSystem(system, watched));
    if (system !== 'unknown' && !read) missing.add(system);
  }
  return [
    ...connected.values(),
    ...[...missing].sort().map((system): Witness => ({ state: 'missing', system })),
  ];
}

// D-092: effects and weak links on their node's reported call; a node with neither is refused by the schema.
export function toSessionCheckInput(api: SessionCheckApi): SessionCheckInput {
  const byId = new Map(api.events.map((event) => [event.id, event]));
  const callOf = (ids: readonly string[]): string =>
    ids.find((id) => byId.get(id)?.kind === 'tool.call') ??
    ids.find((id) => byId.get(id)?.kind === 'mcp.request') ??
    ids[0] ??
    '';
  const sideEffects = [...api.sideEffects.effects, ...api.sideEffects.weak].map((effect) => ({
    worldEventId: effect.worldEventId,
    toolCallId: callOf(effect.toolEventIds),
    confidence: effect.confidence,
    via: effect.reason,
  }));
  return sessionCheckInputSchema.parse({
    // D-092: "Coding agent" until the D-079 question on the agent's own name is answered.
    session: {
      id: api.session.id,
      agent: 'coding-agent',
      startedAt: api.session.startedAt,
      endedAt: api.session.endedAt,
      sample: false,
    },
    events: api.events,
    sideEffects,
    witnesses: roster(api),
  });
}

// The canvas sample stays at its id; every other id is a real session read from the API.
export async function loadSessionCheck(
  id: string,
  client: () => ApiClient = createApiClient,
): Promise<SessionCheck | undefined> {
  if (id === CANVAS_SESSION_ID) {
    return buildSessionCheck(sessionCheckInputSchema.parse(CANVAS_SESSION));
  }
  try {
    return buildSessionCheck(toSessionCheckInput(await client().getSessionCheck(id)));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return undefined;
    throw error;
  }
}
