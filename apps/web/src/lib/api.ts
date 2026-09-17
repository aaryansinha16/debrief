import { type Event, type Run, eventSchema, runSchema } from '@debrief/schema';
import { z } from 'zod';

import { type WebEnv, readEnv } from './env';

export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}

export class ApiNotConfiguredError extends Error {
  override readonly name = 'ApiNotConfiguredError';

  constructor() {
    super('DEBRIEF_API_KEY is not set');
  }
}

const runPageSchema = z.object({ runs: z.array(runSchema), nextCursor: z.string().optional() });
export type RunPage = z.infer<typeof runPageSchema>;

const eventPageSchema = z.object({
  events: z.array(eventSchema),
  nextCursor: z.string().optional(),
});

const divergencePointSchema = z.object({
  eventId: z.string(),
  seq: z.number().int(),
  kind: z.string(),
  nodeId: z.string().optional(),
  effect: z.enum(['deny', 'require_approval']),
  ruleId: z.string().optional(),
  explanation: z.string(),
});
export type DivergencePoint = z.infer<typeof divergencePointSchema>;

const divergenceSchema = z.object({
  runId: z.string(),
  evaluated: z.number().int(),
  points: z.array(divergencePointSchema),
  freezeFrame: divergencePointSchema.optional(),
});
export type Divergence = z.infer<typeof divergenceSchema>;

const positionSchema = z.object({ x: z.number(), y: z.number(), z: z.number() });
const graphNodeSchema = z.object({
  id: z.string(),
  type: z.enum([
    'principal',
    'human',
    'agent',
    'subagent',
    'grant',
    'llm',
    'tool',
    'system',
    'resource',
    'policy',
  ]),
  label: z.string(),
  ts: z.string(),
  eventIds: z.array(z.string()),
});
const graphEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum([
    'triggers',
    'calls',
    'returns',
    'authorized_by',
    'delegates_to',
    'mutates',
    'observes',
    'messages',
  ]),
  confidence: z.enum(['exact', 'strong', 'weak']),
  eventIds: z.array(z.string()),
});
export const causalGraphSchema = z.object({
  runId: z.string(),
  version: z.string(),
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
});
export const layoutSchema = z.object({
  version: z.string(),
  seed: z.string(),
  iterations: z.number().int(),
  positions: z.record(z.string(), positionSchema),
  bounds: z.object({ min: positionSchema, max: positionSchema }),
});
const keyframeSchema = z.object({
  t: z.number(),
  position: z.tuple([z.number(), z.number(), z.number()]),
  target: z.tuple([z.number(), z.number(), z.number()]),
  fov: z.number(),
  easing: z.enum(['linear', 'ease-in-out', 'ease-out']),
  label: z.enum(['establishing', 'follow', 'freeze', 'ripple', 'pull-back']),
  nodeId: z.string().optional(),
});
const graphResponseSchema = z.object({
  runId: z.string(),
  headSeq: z.number().int(),
  graph: causalGraphSchema,
  layout: layoutSchema,
  keyframes: z.array(keyframeSchema),
  divergence: divergenceSchema,
  cached: z.object({ events: z.boolean(), layout: z.boolean() }),
});
export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type CausalGraph = z.infer<typeof causalGraphSchema>;
export type Layout = z.infer<typeof layoutSchema>;
export type Keyframe = z.infer<typeof keyframeSchema>;
export type GraphResponse = z.infer<typeof graphResponseSchema>;

const proofSchema = z.object({
  event: z.object({ id: z.string(), seq: z.number().int(), hash: z.string() }),
  checkpoint: z.record(z.string(), z.unknown()),
  proof: z.array(z.string()),
});
export type Proof = z.infer<typeof proofSchema>;

export const EVENT_PAGE = 1000;
export const MAX_EVENTS = 50_000;

export interface ApiClient {
  listRuns(options?: { limit?: number; cursor?: string }): Promise<RunPage>;
  getRun(id: string): Promise<Run>;
  listEvents(id: string): Promise<Event[]>;
  getDivergence(id: string, policyId?: string): Promise<Divergence>;
  getGraph(id: string, policyId?: string): Promise<GraphResponse>;
  getProof(eventId: string): Promise<Proof>;
}

type Fetch = typeof fetch;

// Validates every response at the boundary; server-only because it carries the tenant key.
export function createApiClient(env: WebEnv = readEnv(), fetchImpl: Fetch = fetch): ApiClient {
  const key = env.DEBRIEF_API_KEY;
  const request = async <T>(schema: z.ZodType<T>, path: string, body?: unknown): Promise<T> => {
    if (key === undefined) throw new ApiNotConfiguredError();
    const headers: Record<string, string> = {
      authorization: `Bearer ${key}`,
      accept: 'application/json',
    };
    const init: RequestInit = { headers, cache: 'no-store' };
    if (body !== undefined) {
      init.method = 'POST';
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const response = await fetchImpl(new URL(path, env.DEBRIEF_API_URL), init);
    if (!response.ok) {
      throw new ApiError(response.status, path, `${String(response.status)} from ${path}`);
    }
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw new ApiError(response.status, path, `unexpected shape from ${path}`);
    return parsed.data;
  };
  return {
    listRuns: (options = {}) => {
      const query = new URLSearchParams();
      if (options.limit !== undefined) query.set('limit', String(options.limit));
      if (options.cursor !== undefined) query.set('cursor', options.cursor);
      const suffix = query.size === 0 ? '' : `?${query.toString()}`;
      return request(runPageSchema, `/v1/runs${suffix}`);
    },
    getRun: (id) => request(runSchema, `/v1/runs/${encodeURIComponent(id)}`),
    listEvents: async (id) => {
      const events: Event[] = [];
      let cursor: string | undefined;
      while (events.length < MAX_EVENTS) {
        const query = new URLSearchParams({ limit: String(EVENT_PAGE) });
        if (cursor !== undefined) query.set('cursor', cursor);
        const page = await request(
          eventPageSchema,
          `/v1/runs/${encodeURIComponent(id)}/events?${query.toString()}`,
        );
        events.push(...page.events);
        if (page.nextCursor === undefined) break;
        cursor = page.nextCursor;
      }
      return events;
    },
    getDivergence: (id, policyId = 'prod-guard') =>
      request(divergenceSchema, `/v1/runs/${encodeURIComponent(id)}/divergence`, { policyId }),
    getGraph: (id, policyId = 'prod-guard') =>
      request(
        graphResponseSchema,
        `/v1/runs/${encodeURIComponent(id)}/graph?policy=${encodeURIComponent(policyId)}`,
      ),
    getProof: (eventId) => request(proofSchema, `/v1/proof?event=${encodeURIComponent(eventId)}`),
  };
}
