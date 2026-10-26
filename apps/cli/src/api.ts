import { witnessTrustSchema } from '@debrief/schema';
import { z } from 'zod';

import type { WireEvent } from './wire.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    route: string,
  ) {
    super(`${route} answered ${String(status)}`);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  apiUrl: string;
  key: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

const ingestSchema = z.looseObject({ accepted: z.number(), duplicates: z.number() });
const meSchema = z.looseObject({
  keyId: z.string(),
  tenantId: z.string(),
  trust: witnessTrustSchema,
});
const issuedSchema = z.looseObject({ id: z.string(), key: z.string(), trust: witnessTrustSchema });

async function call<T>(
  options: ApiOptions,
  method: 'GET' | 'POST',
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const send = options.fetch ?? fetch;
  const headers: Record<string, string> = { authorization: `Bearer ${options.key}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await send(`${options.apiUrl.replace(/\/+$/, '')}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (!response.ok) throw new ApiError(response.status, `${method} ${path}`);
  return schema.parse(await response.json());
}

export const postEvents = (options: ApiOptions, events: readonly WireEvent[]) =>
  call(options, 'POST', '/v1/events', ingestSchema, { events });

export const whoAmI = (options: ApiOptions) => call(options, 'GET', '/v1/me', meSchema);

// D-084: the hook's key holds local trust, so nothing on the agent's machine can assert third-party.
export const issueLocalKey = (options: ApiOptions, name: string) =>
  call(options, 'POST', '/v1/keys', issuedSchema, { name, trust: 'local' });
