import {
  type PublicKeyEntry,
  verifyCheckpoint,
  verifyConsistency,
  verifyInclusion,
} from '@debrief/chain';
import { checkpointSchema, type Checkpoint } from '@debrief/schema';
import { otelFixtureSpans } from '@debrief/schema/fixtures';
import { hexToBytes } from '@noble/hashes/utils.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { Logger } from 'nestjs-pino';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { generateApiKey } from '../auth/api-keys.js';
import { CONFIG, type Config } from '../config/config.js';
import { runMigrations } from '../db/migrate.js';
import { EventsRepository } from '../events/events.repository.js';
import { toOtlpJson } from '../otlp/otlp-json.js';
import { SIGNING_KEY, type SigningKey } from '../signing/signing-key.js';
import { MemoryObjectStore, OBJECT_STORE, type ObjectStore } from '../storage/object-store.js';
import { adminUrlFromEnv, createTempDatabase, type TempDatabase } from '../test/temp-db.js';
import { CheckpointerService, checkpointObjectKey } from './checkpointer.service.js';
import { CheckpointsRepository } from './checkpoints.repository.js';
import type { InclusionProofResponse } from './checkpoints.controller.js';
import { TreeCache } from './tree-cache.js';

const adminUrl = adminUrlFromEnv();

describe.skipIf(adminUrl === undefined)('checkpoints and proofs', () => {
  let temp: TempDatabase;
  let admin: Sql;
  let app: NestFastifyApplication;
  let keys: PublicKeyEntry[];
  const key = generateApiKey();

  beforeAll(async () => {
    temp = await createTempDatabase(adminUrl!);
    await runMigrations({ adminUrl: temp.adminUrl, appRole: temp.role });
    admin = postgres(temp.adminUrl, { max: 1, onnotice: () => undefined });
    await admin.unsafe(`INSERT INTO tenants (id, name) VALUES ('t1', 'One')`);
    await admin.unsafe(
      `INSERT INTO api_keys (id, tenant_id, key_hash, prefix, name) VALUES ('k1', 't1', '${key.keyHash}', '${key.prefix}', 'one')`,
    );
    process.env.DATABASE_URL = temp.appUrl;
    process.env.CHECKPOINT_EVERY_EVENTS = '5';
    process.env.CHECKPOINT_INTERVAL_MS = '60000';
    app = await createApp();
    await app.init();
    const wellKnown = await get('/.well-known/debrief-keys.json', null);
    expect(wellKnown.headers['access-control-allow-origin']).toBe('*');
    keys = wellKnown.json<{ keys: PublicKeyEntry[] }>().keys;
  });

  afterAll(async () => {
    await app.close();
    await admin.end();
    await temp.drop();
    delete process.env.CHECKPOINT_EVERY_EVENTS;
    delete process.env.CHECKPOINT_INTERVAL_MS;
  });

  const server = (): FastifyInstance => app.getHttpAdapter().getInstance() as FastifyInstance;
  const auth = (bearer: string | null): Record<string, string> =>
    bearer === null ? {} : { authorization: `Bearer ${bearer}` };
  const get = (url: string, bearer: string | null = key.key): Promise<LightMyRequestResponse> =>
    server().inject({ method: 'GET', url, headers: auth(bearer) });
  const postJson = (url: string, body: unknown): Promise<LightMyRequestResponse> =>
    server().inject({
      method: 'POST',
      url,
      headers: { ...auth(key.key), 'content-type': 'application/json' },
      payload: JSON.stringify(body),
    });

  const proofFor = async (query: string): Promise<InclusionProofResponse> => {
    const res = await get(`/v1/proof?${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return res.json<InclusionProofResponse>();
  };

  const verifies = (proof: InclusionProofResponse): boolean =>
    verifyCheckpoint(checkpointSchema.parse(proof.checkpoint), keys).ok &&
    verifyInclusion(
      hexToBytes(proof.event.hash),
      proof.event.seq,
      proof.checkpoint.treeSize,
      proof.proof,
      proof.checkpoint.rootHash,
    );

  it('publishes the signing key and starts with no checkpoints', async () => {
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ keyId: '21fe31dfa154a261', alg: 'ed25519' });
    expect((await get('/.well-known/debrief-keys.json', null)).statusCode).toBe(200);
    expect((await get('/v1/checkpoints')).json()).toEqual({ checkpoints: [] });
    expect((await get('/v1/checkpoints', null)).statusCode).toBe(401);
  });

  it('cuts a checkpoint over the ingested fixtures and proves every event against it', async () => {
    const ingest = await postJson('/v1/traces', toOtlpJson(otelFixtureSpans()));
    expect(ingest.statusCode).toBe(200);
    const events = await app.get(EventsRepository).list('t1');
    expect(events).toHaveLength(15);
    expect((await get(`/v1/proof?event=${events[0]!.id}`)).statusCode).toBe(404);

    const checkpoint = await app.get(CheckpointerService).checkpointTenant('t1');
    expect(checkpoint).toMatchObject({ tenantId: 't1', treeSize: 15, headHash: events[14]!.hash });
    expect(verifyCheckpoint(checkpoint!, keys)).toEqual({ ok: true, keyId: '21fe31dfa154a261' });
    expect((await get('/v1/checkpoints')).json()).toEqual({ checkpoints: [checkpoint] });

    for (const event of events) {
      const byId = await proofFor(`event=${event.id}`);
      expect(byId.event).toEqual({ id: event.id, seq: event.seq, hash: event.hash });
      expect(byId.checkpoint).toEqual(checkpoint);
      expect(byId.proof.length).toBeLessThanOrEqual(4);
      expect(verifies(byId), `seq ${String(event.seq)}`).toBe(true);
      expect(await proofFor(`seq=${String(event.seq)}`)).toEqual(byId);
      const tampered = { ...byId, event: { ...byId.event, hash: 'ab'.repeat(32) } };
      expect(verifies(tampered)).toBe(false);
    }
  });

  it('mirrors the checkpoint to object storage', async () => {
    const [latest] = (await app.get(CheckpointsRepository).list('t1', 1)) as [Checkpoint];
    const stored = await app.get<ObjectStore>(OBJECT_STORE).get(checkpointObjectKey(latest));
    expect(stored?.contentType).toBe('application/json');
    expect(JSON.parse(new TextDecoder().decode(stored!.body))).toEqual(latest);
    expect(app.get(CheckpointerService).unmirroredCount()).toBe(0);
  });

  it('does nothing when no events arrived, cuts after the event threshold, and keeps the log consistent', async () => {
    const checkpointer = app.get(CheckpointerService);
    const before = (await checkpointer.runDue(Date.now())).length;
    expect(before).toBe(0);
    const native = Array.from({ length: 5 }, (_, n) => ({
      sourceTs: '2026-09-17T00:00:09.000Z',
      source: 'world-hook',
      provenance: 'observed',
      runId: '4bf92f3577b34da6a3ce929d0e0e4736',
      kind: 'world.change',
      actor: { type: 'system', id: 'orbital-infra' },
      attrs: { n },
      sourceId: `change:${String(n)}`,
    }));
    expect((await postJson('/v1/events', { events: native })).statusCode).toBe(200);
    const cut = await checkpointer.runDue(Date.now());
    expect(cut.map((checkpoint) => checkpoint.treeSize)).toEqual([20]);
    const [newer, older] = await app.get(CheckpointsRepository).list('t1', 2);
    expect([older!.treeSize, newer!.treeSize]).toEqual([15, 20]);
    const tree = await app.get(TreeCache).treeFor('t1', 20);
    const consistency = tree.consistencyProof(15, 20);
    expect(verifyConsistency(15, 20, older!.rootHash, newer!.rootHash, consistency)).toBe(true);
    const proof = await proofFor('seq=3');
    expect(proof.checkpoint.treeSize).toBe(20);
    expect(verifies(proof)).toBe(true);
    expect((await checkpointer.runDue(Date.now())).length).toBe(0);
  });

  it('cuts on the time threshold even below the event threshold', async () => {
    const checkpointer = app.get(CheckpointerService);
    expect(
      (
        await postJson('/v1/events', {
          events: [
            {
              sourceTs: '2026-09-17T00:00:10.000Z',
              source: 'api',
              provenance: 'reported',
              runId: '4bf92f3577b34da6a3ce929d0e0e4736',
              kind: 'error',
              actor: { type: 'system', id: 'x' },
              attrs: {},
            },
          ],
        })
      ).statusCode,
    ).toBe(200);
    expect((await checkpointer.runDue(Date.now())).length).toBe(0);
    const cut = await checkpointer.runDue(Date.now() + 60_001);
    expect(cut.map((checkpoint) => checkpoint.treeSize)).toEqual([21]);
  });

  it('rejects bad proof queries', async () => {
    expect((await get('/v1/proof')).statusCode).toBe(400);
    expect((await get('/v1/proof?event=a&seq=1')).statusCode).toBe(400);
    expect((await get('/v1/proof?seq=-1')).statusCode).toBe(400);
    expect((await get('/v1/proof?event=01J8ZK5R4M2X6P9Q3V7W1Y5N8B')).statusCode).toBe(404);
    expect((await get('/v1/proof?seq=999')).statusCode).toBe(404);
    expect((await get('/v1/checkpoints?limit=0')).statusCode).toBe(400);
    expect((await get('/v1/proof?seq=0', null)).statusCode).toBe(401);
  });

  it('retries mirroring when the object store fails', async () => {
    let fail = true;
    const flaky = new (class extends MemoryObjectStore {
      override put(key: string, body: Uint8Array, contentType: string): Promise<void> {
        if (fail) return Promise.reject(new Error('store down'));
        return super.put(key, body, contentType);
      }
    })();
    const checkpointer = new CheckpointerService(
      app.get<Config>(CONFIG),
      app.get<SigningKey>(SIGNING_KEY),
      flaky,
      app.get(EventsRepository),
      app.get(CheckpointsRepository),
      app.get(TreeCache),
      app.get(Logger),
    );
    await admin.unsafe(`INSERT INTO tenants (id, name) VALUES ('t2', 'Two')`);
    await app.get(EventsRepository).append('t2', [
      {
        input: {
          id: '01J8ZK5R4M2X6P9Q3V7W1Y5N8B',
          tenantId: 't2',
          ts: '2026-09-17T00:00:00.000Z',
          sourceTs: '2026-09-17T00:00:00.000Z',
          source: 'api',
          provenance: 'reported',
          runId: 'r',
          kind: 'error',
          actor: { type: 'system', id: 'x' },
          attrs: {},
        },
      },
    ]);
    const checkpoint = await checkpointer.checkpointTenant('t2');
    expect(checkpoint?.treeSize).toBe(1);
    expect(checkpointer.unmirroredCount()).toBe(1);
    fail = false;
    expect(await checkpointer.runDue(Date.now())).toEqual([]);
    expect(checkpointer.unmirroredCount()).toBe(0);
    expect(flaky.objects.has(checkpointObjectKey(checkpoint!))).toBe(true);
    checkpointer.onModuleInit();
    checkpointer.onModuleDestroy();
  });
});
