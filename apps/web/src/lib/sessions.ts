import { CANVAS_SESSION, CANVAS_SESSION_ID } from './__fixtures__/canvas-claims';
import { ApiError, type ApiClient, createApiClient } from './api';
import type { SessionCheckApi } from './session-api';
import { type SessionCheck, buildSessionCheck } from './session-check';
import { type SessionCheckInput, sessionCheckInputSchema } from './session-check-input';

export const SAMPLE_SESSION_ID = CANVAS_SESSION_ID;

const TRUST_RANK = { local: 0, 'third-party': 1 } as const;

type Witness = SessionCheckInput['witnesses'][number];

// One roster entry per system: the better trust wins, the counts add up; claims on an unwatched system name it missing.
function roster(api: SessionCheckApi): Witness[] {
  const connected = new Map<string, Extract<Witness, { state: 'connected' }>>();
  for (const witness of api.witnesses) {
    const current = connected.get(witness.system);
    connected.set(witness.system, {
      state: 'connected',
      system: witness.system,
      trust:
        current === undefined || TRUST_RANK[witness.trust] > TRUST_RANK[current.trust]
          ? witness.trust
          : current.trust,
      observed: (current?.observed ?? 0) + witness.events,
    });
  }
  const missing = new Set<string>();
  for (const claim of api.claims) {
    const system = claim.subject.system;
    if (system !== 'unknown' && !connected.has(system)) missing.add(system);
  }
  return [
    ...connected.values(),
    ...[...missing].sort().map((system): Witness => ({ state: 'missing', system })),
  ];
}

// D-092: P-65's effects and weak links become the page's side effects; the tool call is the node's reported call.
export function toSessionCheckInput(api: SessionCheckApi): SessionCheckInput {
  const byId = new Map(api.events.map((event) => [event.id, event]));
  const sideEffects = [...api.sideEffects.effects, ...api.sideEffects.weak].flatMap((effect) => {
    const toolCallId = effect.toolEventIds.find((id) => {
      const kind = byId.get(id)?.kind;
      return kind === 'tool.call' || kind === 'mcp.request';
    });
    return toolCallId === undefined
      ? []
      : [
          {
            worldEventId: effect.worldEventId,
            toolCallId,
            confidence: effect.confidence,
            via: effect.reason,
          },
        ];
  });
  return sessionCheckInputSchema.parse({
    session: {
      id: api.session.id,
      agent: api.session.agent ?? 'coding-agent',
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
