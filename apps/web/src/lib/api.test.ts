import type { Run } from '@debrief/schema';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, ApiNotConfiguredError, createApiClient } from './api';

const run: Run = {
  id: 'a1ad49b23b7fcebdac2bba6d1a244b1a',
  tenantId: 'tenant-demo',
  principalId: 'human:aaryan',
  agentName: 'coding-agent',
  startedAt: '2026-09-17T10:35:52.000Z',
  endedAt: '2026-09-17T10:35:58.000Z',
  eventCount: 47,
  status: 'ended',
  riskMax: 'critical',
  divergenceCount: 0,
  graphVersion: 1,
};

const env = { DEBRIEF_API_URL: 'http://api.test:4000', DEBRIEF_API_KEY: 'dbk_test' };
const respond = (status: number, body: unknown) =>
  vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );

const calledUrl = (fetchImpl: ReturnType<typeof respond>, call = 0): string => {
  const [url] = fetchImpl.mock.calls[call]!;
  expect(url).toBeInstanceOf(URL);
  return url instanceof URL ? url.href : '';
};

describe('api client', () => {
  it('lists runs with the bearer key and validates the shape', async () => {
    const fetchImpl = respond(200, { runs: [run], nextCursor: 'abc' });
    const page = await createApiClient(env, fetchImpl).listRuns({ limit: 10, cursor: 'c1' });
    expect(page).toEqual({ runs: [run], nextCursor: 'abc' });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(calledUrl(fetchImpl)).toBe('http://api.test:4000/v1/runs?limit=10&cursor=c1');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer dbk_test' });
    expect(init?.cache).toBe('no-store');
    const bare = respond(200, { runs: [] });
    await createApiClient(env, bare).listRuns();
    expect(calledUrl(bare)).toBe('http://api.test:4000/v1/runs');
  });

  it('gets a run by id, encoding it', async () => {
    const fetchImpl = respond(200, run);
    expect(await createApiClient(env, fetchImpl).getRun('a b')).toEqual(run);
    expect(calledUrl(fetchImpl)).toBe('http://api.test:4000/v1/runs/a%20b');
  });

  it('maps http errors, bad shapes and a missing key to typed errors', async () => {
    await expect(
      createApiClient(env, respond(404, { message: 'nope' })).getRun('x'),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      path: '/v1/runs/x',
    });
    await expect(
      createApiClient(env, respond(200, { runs: [{ id: 1 }] })).listRuns(),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      createApiClient({ DEBRIEF_API_URL: env.DEBRIEF_API_URL }, respond(200, {})).listRuns(),
    ).rejects.toBeInstanceOf(ApiNotConfiguredError);
    expect(new ApiError(500, '/x', 'boom').message).toBe('boom');
  });
});
