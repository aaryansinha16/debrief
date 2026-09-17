import { type Run, runSchema } from '@debrief/schema';
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

export interface ApiClient {
  listRuns(options?: { limit?: number; cursor?: string }): Promise<RunPage>;
  getRun(id: string): Promise<Run>;
}

type Fetch = typeof fetch;

// Validates every response at the boundary; server-only because it carries the tenant key.
export function createApiClient(env: WebEnv = readEnv(), fetchImpl: Fetch = fetch): ApiClient {
  const key = env.DEBRIEF_API_KEY;
  const request = async <T>(schema: z.ZodType<T>, path: string): Promise<T> => {
    if (key === undefined) throw new ApiNotConfiguredError();
    const response = await fetchImpl(new URL(path, env.DEBRIEF_API_URL), {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      cache: 'no-store',
    });
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
  };
}
