import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { generateApiKey } from '../auth/api-keys.js';
import { runMigrations } from '../db/migrate.js';
import { EventsRepository } from '../events/events.repository.js';
import { adminUrlFromEnv, createTempDatabase, type TempDatabase } from '../test/temp-db.js';
import type { NativeEvent } from './native-events.js';

const adminUrl = adminUrlFromEnv();
const NUL = String.fromCharCode(0);

const nativeEvent = (n: number, patch: Partial<NativeEvent> = {}): NativeEvent => ({
  sourceTs: '2026-09-17T00:00:01.000+05:30',
  source: 'world-hook',
  provenance: 'observed',
  runId: '4bf92f3577b34da6a3ce929d0e0e4736',
  kind: 'world.change',
  actor: { type: 'system', id: 'orbital-infra' },
  target: {
    system: 'orbital',
    resource: `vol-${String(n)}`,
    environment: 'production',
    operation: 'deleteVolume',
    risk: 'critical',
  },
  attrs: { 'world.field': 'backupExists', 'world.before': true, 'world.after': false, n },
  summary: `volume vol-${String(n)} deleted`,
  sourceId: `orbital:change:${String(n)}`,
  ...patch,
});

describe.skipIf(adminUrl === undefined)('POST /v1/events', () => {
  let temp: TempDatabase;
  let admin: Sql;
  let app: NestFastifyApplication;
  const key = generateApiKey();
  const otherKey = generateApiKey();
  const rateKey = generateApiKey();

  beforeAll(async () => {
    temp = await createTempDatabase(adminUrl!);
    await runMigrations({ adminUrl: temp.adminUrl, appRole: temp.role });
    admin = postgres(temp.adminUrl, { max: 1, onnotice: () => undefined });
    await admin.unsafe(`INSERT INTO tenants (id, name) VALUES ('t1', 'One')`);
    await admin.unsafe(
      `INSERT INTO api_keys (id, tenant_id, key_hash, prefix, name) VALUES
       ('k1', 't1', '${key.keyHash}', '${key.prefix}', 'one'),
       ('k2', 't1', '${otherKey.keyHash}', '${otherKey.prefix}', 'two'),
       ('k3', 't1', '${rateKey.keyHash}', '${rateKey.prefix}', 'three')`,
    );
    process.env.DATABASE_URL = temp.appUrl;
    process.env.RATE_LIMIT_PER_MINUTE = '25';
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await admin.end();
    await temp.drop();
    delete process.env.RATE_LIMIT_PER_MINUTE;
  });

  const post = (
    payload: string,
    bearer: string | null = key.key,
    url = '/v1/events',
  ): Promise<LightMyRequestResponse> => {
    const server = app.getHttpAdapter().getInstance() as FastifyInstance;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (bearer !== null) headers.authorization = `Bearer ${bearer}`;
    return server.inject({ method: 'POST', url, headers, payload });
  };

  const count = async (): Promise<number> =>
    (await app.get(EventsRepository).list('t1', 0, 10_000)).length;

  it('stores a batch once and reports duplicates on replay', async () => {
    const batch = JSON.stringify({ events: [nativeEvent(1), nativeEvent(2), nativeEvent(3)] });
    const first = await post(batch);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({
      accepted: 3,
      duplicates: 0,
      events: [{ seq: 0 }, { seq: 1 }, { seq: 2 }],
    });
    const replay = await post(batch);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ accepted: 0, duplicates: 3, events: [] });
    expect(await count()).toBe(3);
    const [stored] = await app.get(EventsRepository).list('t1', 0, 1);
    expect(stored).toMatchObject({
      tenantId: 't1',
      seq: 0,
      source: 'world-hook',
      provenance: 'observed',
      kind: 'world.change',
    });
    expect(stored!.ts.endsWith('Z')).toBe(true);
    expect(stored!.sourceTs).toBe('2026-09-17T00:00:01.000+05:30');
  });

  it('stores events without a sourceId every time', async () => {
    const { sourceId: _omit, ...plain } = nativeEvent(9);
    const batch = JSON.stringify({ events: [plain] });
    expect((await post(batch)).json()).toMatchObject({ accepted: 1, duplicates: 0 });
    expect((await post(batch)).json()).toMatchObject({ accepted: 1, duplicates: 0 });
    expect(await count()).toBe(5);
  });

  it('returns 413 for too many events or too many bytes', async () => {
    const many = JSON.stringify({
      events: Array.from({ length: 1001 }, (_, n) => nativeEvent(100 + n)),
    });
    expect((await post(many)).statusCode).toBe(413);
    const fat = JSON.stringify({ events: [nativeEvent(5)], pad: 'y'.repeat(1024 * 1024) });
    expect((await post(fat)).statusCode).toBe(413);
    expect(await count()).toBe(5);
  });

  it.each([
    ['unknown kind', { events: [nativeEvent(1, { kind: 'agent.think' as NativeEvent['kind'] })] }],
    ['client-supplied id', { events: [{ ...nativeEvent(1), id: '01J8ZK5R4M2X6P9Q3V7W1Y5N8B' }] }],
    ['client-supplied ts', { events: [{ ...nativeEvent(1), ts: '2026-09-17T00:00:00Z' }] }],
    ['client-supplied tenantId', { events: [{ ...nativeEvent(1), tenantId: 'other' }] }],
    ['otlp as source', { events: [nativeEvent(1, { source: 'otlp' as NativeEvent['source'] })] }],
    [
      'content attribute',
      { events: [nativeEvent(1, { attrs: { 'gen_ai.input.messages': 's' } })] },
    ],
    ['empty batch', { events: [] }],
    ['unknown top-level key', { events: [nativeEvent(1)], extra: 1 }],
    ['nul character', { events: [nativeEvent(1, { summary: `a${NUL}b` })] }],
    ['not a batch', [nativeEvent(1)]],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await post(JSON.stringify(body));
    expect(res.statusCode, res.body).toBe(400);
  });

  it('accepts content and applies the tenant capture mode', async () => {
    await admin.unsafe(`INSERT INTO tenants (id, name, capture_mode) VALUES ('t-on', 'On', 'on')`);
    const onKey = generateApiKey();
    await admin.unsafe(
      `INSERT INTO api_keys (id, tenant_id, key_hash, prefix, name) VALUES ('k-on', 't-on', '${onKey.keyHash}', '${onKey.prefix}', 'on')`,
    );
    const event = {
      ...nativeEvent(400),
      source: 'mcp-proxy',
      kind: 'mcp.request',
      summary: 'mcp tools/call deleteVolume',
      content: {
        'gen_ai.tool.call.arguments': '{"volumeId":"vol-prod-01","token":"orb_live_9f3aQ7xLm2"}',
      },
    };
    const offRes = await post(JSON.stringify({ events: [event] }));
    expect(offRes.statusCode, offRes.body).toBe(200);
    const [offStored] = await app
      .get(EventsRepository)
      .list('t1', 0, 10_000)
      .then((all) => all.slice(-1));
    expect(offStored!.payloadSha256).toBeUndefined();
    expect(offStored!.summary).toBe('mcp tools/call deleteVolume');
    const onRes = await post(JSON.stringify({ events: [event] }), onKey.key);
    expect(onRes.statusCode, onRes.body).toBe(200);
    const [onStored] = await app.get(EventsRepository).list('t-on', 0, 10);
    expect(onStored!.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(onStored!.summary).toMatch(/^mcp tools\/call deleteVolume · “/);
    expect(onStored!.summary).not.toContain('orb_live_9f3aQ7xLm2');
    const dump = JSON.stringify(
      await admin.unsafe(`SELECT * FROM events WHERE tenant_id = 't-on'`),
    );
    expect(dump).not.toContain('orb_live_9f3aQ7xLm2');
    expect(dump).not.toContain('gen_ai.tool.call.arguments');
    const badKey = await post(
      JSON.stringify({ events: [{ ...event, content: { 'mcp.method.name': 'x' } }] }),
      onKey.key,
    );
    expect(badKey.statusCode).toBe(400);
    const huge = await post(
      JSON.stringify({
        events: [{ ...event, content: { 'gen_ai.tool.call.result': 'x'.repeat(300 * 1024) } }],
      }),
      onKey.key,
    );
    expect(huge.statusCode).toBe(400);
  });

  it('rejects a missing key with 401', async () => {
    const res = await post(JSON.stringify({ events: [nativeEvent(1)] }), null);
    expect(res.statusCode).toBe(401);
  });

  it('rate limits per key with retry-after, shared across ingest routes', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      const res = await post(JSON.stringify({ events: [nativeEvent(200 + i)] }), rateKey.key);
      statuses.push(res.statusCode);
      expect(res.headers['x-ratelimit-limit']).toBe('25');
      expect(res.headers['x-ratelimit-remaining']).toBe(String(24 - i));
    }
    expect(statuses.every((status) => status === 200)).toBe(true);
    const limited = await post(JSON.stringify({ events: [nativeEvent(299)] }), rateKey.key);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toMatch(/^[1-9]\d*$/);
    expect(limited.headers['x-ratelimit-remaining']).toBe('0');
    expect(limited.json()).toMatchObject({ statusCode: 429, message: 'rate limit exceeded' });
    const other = await post(JSON.stringify({ events: [nativeEvent(300)] }), otherKey.key);
    expect(other.statusCode).toBe(200);
    expect((await post('{}', rateKey.key, '/v1/traces')).statusCode).toBe(429);
  });
});
