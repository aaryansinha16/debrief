import { PROD_GUARD_YAML } from '@debrief/policy';
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import type { Event, EventInput } from '@debrief/schema';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { generateApiKey } from '../auth/api-keys.js';
import { runMigrations } from '../db/migrate.js';
import { EventsRepository } from '../events/events.repository.js';
import { RunsService } from '../runs/runs.service.js';
import { adminUrlFromEnv, createTempDatabase, type TempDatabase } from '../test/temp-db.js';
import type { GraphResponse } from './reconstruction.service.js';

const adminUrl = adminUrlFromEnv();

const toInput = (event: Event): EventInput => {
  const { seq: _seq, prevHash: _prev, hash: _hash, ...rest } = event;
  return { ...rest, tenantId: 't1' };
};

describe.skipIf(adminUrl === undefined)('reconstruction endpoints', () => {
  let temp: TempDatabase;
  let admin: Sql;
  let app: NestFastifyApplication;
  const key = generateApiKey();
  const fixture = demoRunFixture();
  let deleteTool = '';

  beforeAll(async () => {
    temp = await createTempDatabase(adminUrl!);
    await runMigrations({ adminUrl: temp.adminUrl, appRole: temp.role });
    admin = postgres(temp.adminUrl, { max: 1, onnotice: () => undefined });
    await admin.unsafe(`INSERT INTO tenants (id, name) VALUES ('t1', 'One')`);
    await admin.unsafe(
      `INSERT INTO api_keys (id, tenant_id, key_hash, prefix, name) VALUES ('k1', 't1', '${key.keyHash}', '${key.prefix}', 'one')`,
    );
    process.env.DATABASE_URL = temp.appUrl;
    process.env.RUN_DEBOUNCE_MS = '20';
    app = await createApp();
    await app.init();
    const appended = await app.get(EventsRepository).append(
      't1',
      [...fixture].sort((a, b) => a.seq - b.seq).map((event) => ({ input: toInput(event) })),
    );
    expect(appended.events).toHaveLength(49);
    await app.get(RunsService).settle();
  });

  afterAll(async () => {
    await app.close();
    await admin.end();
    await temp.drop();
    delete process.env.RUN_DEBOUNCE_MS;
  });

  const server = (): FastifyInstance => app.getHttpAdapter().getInstance() as FastifyInstance;
  const get = (url: string): Promise<LightMyRequestResponse> =>
    server().inject({ method: 'GET', url, headers: { authorization: `Bearer ${key.key}` } });
  const post = (url: string, body: unknown): Promise<LightMyRequestResponse> =>
    server().inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json' },
      payload: JSON.stringify(body),
    });
  const storedLayout = async (): Promise<Record<string, unknown> | null> => {
    const [row] = await admin.unsafe(
      `SELECT layout, graph_version FROM runs WHERE id = '${DEMO_RUN_ID}'`,
    );
    return (row?.layout as Record<string, unknown> | null) ?? null;
  };

  it('serves the graph with layout and keyframes, then warm from cache in under 300 ms', async () => {
    const cold = await get(`/v1/runs/${DEMO_RUN_ID}/graph`);
    expect(cold.statusCode, cold.body).toBe(200);
    const first = cold.json<GraphResponse>();
    expect(first.graph.nodes).toHaveLength(26);
    expect(first.headSeq).toBe(48);
    expect(first.cached).toEqual({ events: false, layout: false });
    expect(first.layout).toMatchObject({ seed: DEMO_RUN_ID, version: '1' });
    expect(Object.keys(first.layout.positions)).toHaveLength(26);
    expect(first.keyframes.map((frame) => frame.label)).toContain('freeze');
    expect(first.divergence.freezeFrame).toMatchObject({ seq: 45, effect: 'require_approval' });
    deleteTool = first.divergence.freezeFrame!.nodeId!;
    const stored = await storedLayout();
    expect(stored).toMatchObject({
      layoutVersion: '1',
      graphVersion: '1',
      headSeq: 48,
      seed: DEMO_RUN_ID,
    });

    const started = performance.now();
    const warm = await get(`/v1/runs/${DEMO_RUN_ID}/graph`);
    const elapsed = performance.now() - started;
    expect(warm.statusCode).toBe(200);
    expect(elapsed).toBeLessThan(300);
    const second = warm.json<GraphResponse>();
    expect(second.cached).toEqual({ events: true, layout: true });
    expect(second.layout).toEqual(first.layout);
    expect(second.keyframes).toEqual(first.keyframes);
  });

  it('invalidates on new events and on a layout version bump, and does not persist custom seeds', async () => {
    const last = fixture.filter((event) => event.runId === DEMO_RUN_ID).at(-1)!;
    await app.get(EventsRepository).append('t1', [
      {
        input: {
          ...toInput(last),
          id: '01M2QF4GZZZZZZZZZZZZZZZZZ9',
          sourceTs: '2026-09-17T11:00:00.000Z',
          kind: 'error',
          actor: { type: 'system', id: 'x' },
          attrs: {},
          summary: 'late error',
        },
      },
    ]);
    const after = (await get(`/v1/runs/${DEMO_RUN_ID}/graph`)).json<GraphResponse>();
    expect(after.headSeq).toBe(49);
    expect(after.cached).toEqual({ events: false, layout: false });
    expect((await storedLayout())?.headSeq).toBe(49);
    expect((await get(`/v1/runs/${DEMO_RUN_ID}/graph`)).json<GraphResponse>().cached).toEqual({
      events: true,
      layout: true,
    });

    await admin.unsafe(
      `UPDATE runs SET layout = jsonb_set(layout, '{layoutVersion}', '"0"') WHERE id = '${DEMO_RUN_ID}'`,
    );
    const bumped = (await get(`/v1/runs/${DEMO_RUN_ID}/graph`)).json<GraphResponse>();
    expect(bumped.cached).toEqual({ events: true, layout: false });
    expect((await storedLayout())?.layoutVersion).toBe('1');

    const seeded = (await get(`/v1/runs/${DEMO_RUN_ID}/graph?seed=other`)).json<GraphResponse>();
    expect(seeded.layout.seed).toBe('other');
    expect(seeded.cached.layout).toBe(false);
    expect(seeded.layout.positions).not.toEqual(after.layout.positions);
    expect((await storedLayout())?.seed).toBe(DEMO_RUN_ID);
    expect(
      (await get(`/v1/runs/${DEMO_RUN_ID}/graph?policy=allow-all`))
        .json<GraphResponse>()
        .keyframes.map((f) => f.label),
    ).not.toContain('freeze');
  });

  it('serves blast radius and lineage for a node', async () => {
    const blast = await get(`/v1/runs/${DEMO_RUN_ID}/blast?node=${encodeURIComponent(deleteTool)}`);
    expect(blast.statusCode, blast.body).toBe(200);
    expect(blast.json<{ waves: unknown[]; recoverable: boolean }>()).toMatchObject({
      recoverable: false,
    });
    expect(blast.json<{ waves: unknown[] }>().waves).toHaveLength(2);
    expect(
      (
        await get(`/v1/runs/${DEMO_RUN_ID}/blast?node=${encodeURIComponent(deleteTool)}&weak=true`)
      ).json<{ minConfidence: string }>().minConfidence,
    ).toBe('weak');
    const lineage = await get(
      `/v1/runs/${DEMO_RUN_ID}/lineage?node=${encodeURIComponent(deleteTool)}`,
    );
    expect(lineage.statusCode).toBe(200);
    expect(lineage.json<{ hops: { type: string }[]; mismatches: number }>()).toMatchObject({
      mismatches: 3,
    });
    expect(lineage.json<{ hops: { type: string }[] }>().hops.map((hop) => hop.type)).toEqual([
      'principal',
      'agent',
      'grant',
    ]);
    expect((await get(`/v1/runs/${DEMO_RUN_ID}/blast`)).statusCode).toBe(400);
    expect((await get(`/v1/runs/${DEMO_RUN_ID}/blast?node=tool:nope`)).statusCode).toBe(404);
    expect((await get(`/v1/runs/${DEMO_RUN_ID}/lineage?node=tool:nope`)).statusCode).toBe(404);
    expect((await get(`/v1/runs/${DEMO_RUN_ID}/blast?node=x&weak=maybe`)).statusCode).toBe(400);
  });

  it('runs divergence and counterfactual from a sample id or policy yaml', async () => {
    const byId = await post(`/v1/runs/${DEMO_RUN_ID}/divergence`, { policyId: 'prod-guard' });
    expect(byId.statusCode, byId.body).toBe(200);
    expect(byId.json<{ freezeFrame?: { seq: number } }>().freezeFrame?.seq).toBe(45);
    const byYaml = await post(`/v1/runs/${DEMO_RUN_ID}/divergence`, { policy: PROD_GUARD_YAML });
    expect(byYaml.json()).toEqual(byId.json());
    const open = await post(`/v1/runs/${DEMO_RUN_ID}/divergence`, { policyId: 'allow-all' });
    expect(open.json<{ points: unknown[] }>().points).toEqual([]);
    const branched = await post(`/v1/runs/${DEMO_RUN_ID}/counterfactual`, {
      policyId: 'prod-guard',
    });
    expect(branched.statusCode).toBe(200);
    expect(branched.json<{ halted: boolean; marked: string[]; runId: string }>()).toMatchObject({
      halted: true,
      runId: DEMO_RUN_ID,
    });
    expect(branched.json<{ marked: string[] }>().marked).toHaveLength(5);
    const bad = await post(`/v1/runs/${DEMO_RUN_ID}/divergence`, {
      policy: 'version: 1\nrules:\n  - id: x\n    match: { a: 1\n',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ issues: { line: number }[] }>().issues[0]?.line).toBe(5);
    expect((await post(`/v1/runs/${DEMO_RUN_ID}/divergence`, {})).statusCode).toBe(400);
    expect(
      (await post(`/v1/runs/${DEMO_RUN_ID}/divergence`, { policyId: 'nope' })).statusCode,
    ).toBe(400);
    expect((await post(`/v1/runs/${DEMO_RUN_ID}/divergence`, { extra: 1 })).statusCode).toBe(400);
  });

  it('rejects unknown runs and missing keys', async () => {
    expect((await get('/v1/runs/nope/graph')).statusCode).toBe(404);
    expect((await post('/v1/runs/nope/divergence', { policyId: 'allow-all' })).statusCode).toBe(
      404,
    );
    expect(
      (await server().inject({ method: 'GET', url: `/v1/runs/${DEMO_RUN_ID}/graph` })).statusCode,
    ).toBe(401);
  });
});
