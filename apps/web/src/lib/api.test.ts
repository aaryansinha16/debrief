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

  it('pages through a run\u2019s events and posts divergence requests', async () => {
    const event = {
      id: '01J8ZK5R4M2X6P9Q3V7W1Y5N00',
      tenantId: 'tenant-demo',
      seq: 0,
      ts: '2026-09-17T00:00:00.000Z',
      sourceTs: '2026-09-17T00:00:00.000Z',
      source: 'api',
      provenance: 'reported',
      runId: run.id,
      kind: 'error',
      actor: { type: 'system', id: 'x' },
      attrs: {},
      prevHash: '0'.repeat(64),
      hash: '0'.repeat(64),
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ events: [event], nextCursor: 'c2' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ events: [{ ...event, seq: 1 }] }), { status: 200 }),
      );
    const events = await createApiClient(env, fetchImpl).listEvents(run.id);
    expect(events.map((entry) => entry.seq)).toEqual([0, 1]);
    expect(calledUrl(fetchImpl, 0)).toBe(
      `http://api.test:4000/v1/runs/${run.id}/events?limit=1000`,
    );
    expect(calledUrl(fetchImpl, 1)).toBe(
      `http://api.test:4000/v1/runs/${run.id}/events?limit=1000&cursor=c2`,
    );
    const divergence = { runId: run.id, evaluated: 1, points: [] };
    const post = respond(200, divergence);
    expect(await createApiClient(env, post).getDivergence(run.id)).toEqual(divergence);
    const [, init] = post.mock.calls[0]!;
    expect(init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ policyId: 'prod-guard' }),
    });
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json' });
    await createApiClient(env, respond(200, divergence)).getDivergence(run.id, 'allow-all');
  });

  it('fetches the reconstruction graph and inclusion proofs', async () => {
    const graphResponse = {
      runId: run.id,
      headSeq: 48,
      graph: {
        runId: run.id,
        version: '1',
        nodes: [
          { id: 'agent:a', type: 'agent', label: 'a', ts: '2026-09-17T00:00:00Z', eventIds: [] },
        ],
        edges: [],
      },
      layout: {
        version: '1',
        seed: run.id,
        iterations: 300,
        positions: { 'agent:a': { x: 1, y: 2, z: 3 } },
        bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 2, z: 3 } },
      },
      keyframes: [
        {
          t: 0,
          position: [0, 0, 10],
          target: [0, 0, 0],
          fov: 50,
          easing: 'ease-in-out',
          label: 'establishing',
        },
      ],
      divergence: { runId: run.id, evaluated: 1, points: [] },
      cached: { events: false, layout: false },
    };
    const fetchImpl = respond(200, graphResponse);
    expect(await createApiClient(env, fetchImpl).getGraph(run.id)).toEqual(graphResponse);
    expect(calledUrl(fetchImpl)).toBe(
      `http://api.test:4000/v1/runs/${run.id}/graph?policy=prod-guard`,
    );
    const proof = {
      event: { id: 'e', seq: 3, hash: 'h' },
      checkpoint: { treeSize: 4 },
      proof: ['a', 'b'],
    };
    const proofFetch = respond(200, proof);
    expect(await createApiClient(env, proofFetch).getProof('e/1')).toEqual(proof);
    expect(calledUrl(proofFetch)).toBe('http://api.test:4000/v1/proof?event=e%2F1');
    const document = { sourceId: 's', content: { 'gen_ai.input.messages': '[secret:abcd1234]' } };
    const blobFetch = respond(200, document);
    expect(await createApiClient(env, blobFetch).getBlob('ab'.repeat(32))).toEqual(document);
    expect(calledUrl(blobFetch)).toBe(`http://api.test:4000/v1/blobs/${'ab'.repeat(32)}`);
    const volume = 'resource:orbital:projects/nova/volumes/vol-prod-01';
    const blast = {
      origin: 'tool:orbital.deleteVolume',
      minConfidence: 'strong',
      waves: [
        {
          hop: 1,
          resources: [
            {
              nodeId: volume,
              system: 'orbital',
              resource: 'projects/nova/volumes/vol-prod-01',
              via: {
                from: 'tool:orbital.deleteVolume',
                to: volume,
                type: 'mutates',
                confidence: 'exact',
                eventIds: ['e1'],
              },
              recoverable: false,
              reasons: ['irreversible-operation', 'backups-deleted'],
            },
          ],
        },
      ],
      groups: { orbital: [volume] },
      recoverable: false,
    };
    const blastFetch = respond(200, blast);
    expect(await createApiClient(env, blastFetch).getBlast(run.id, blast.origin)).toEqual(blast);
    expect(calledUrl(blastFetch)).toBe(
      `http://api.test:4000/v1/runs/${run.id}/blast?node=tool%3Aorbital.deleteVolume`,
    );
    const weakFetch = respond(200, blast);
    await createApiClient(env, weakFetch).getBlast(run.id, blast.origin, true);
    expect(calledUrl(weakFetch)).toContain('&weak=true');
  });

  it('opens the live stream with the key, cursor and last event id, and hands the body back', async () => {
    const body = 'event: run\ndata: {}\n\n';
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      );
    const controller = new AbortController();
    const response = await createApiClient(env, fetchImpl).streamLive({
      since: 41,
      run: 'r/1',
      lastEventId: '40',
      signal: controller.signal,
    });
    expect(await response.text()).toBe(body);
    expect(calledUrl(fetchImpl)).toBe('http://api.test:4000/v1/live?since=41&run=r%2F1');
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer dbk_test',
      accept: 'text/event-stream',
      'last-event-id': '40',
    });
    expect(init?.signal).toBe(controller.signal);
    const bare = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 200 }));
    await createApiClient(env, bare).streamLive();
    expect(calledUrl(bare)).toBe('http://api.test:4000/v1/live');
    expect((bare.mock.calls[0]![1]?.headers as Record<string, string>)['last-event-id']).toBe(
      undefined,
    );
    await expect(
      createApiClient(env, respond(401, { message: 'no' })).streamLive(),
    ).rejects.toMatchObject({ status: 401, path: '/v1/live' });
    await expect(
      createApiClient({ ...env, DEBRIEF_API_KEY: undefined }, bare).streamLive(),
    ).rejects.toBeInstanceOf(ApiNotConfiguredError);
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
