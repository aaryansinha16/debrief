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

export const EVENT_PAGE = 1000;
export const MAX_EVENTS = 50_000;

export interface ApiClient {
  listRuns(options?: { limit?: number; cursor?: string }): Promise<RunPage>;
  getRun(id: string): Promise<Run>;
  listEvents(id: string): Promise<Event[]>;
  getDivergence(id: string, policyId?: string): Promise<Divergence>;
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
  };
}
