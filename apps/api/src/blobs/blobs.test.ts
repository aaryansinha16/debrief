import { verifyChain } from '@debrief/chain';
import { REDACTION_FIXTURES } from '@debrief/schema/redaction-fixtures';
import { otelFixtureSpans } from '@debrief/schema/fixtures';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { generateApiKey } from '../auth/api-keys.js';
import { runMigrations } from '../db/migrate.js';
import { EventsRepository } from '../events/events.repository.js';
import { toOtlpJson } from '../otlp/otlp-json.js';
import { OBJECT_STORE, type ObjectStore } from '../storage/object-store.js';
import {
  TenantKeyDestroyedError,
  TenantKeysService,
  open,
  seal,
} from '../tenants/tenant-keys.service.js';
import { adminUrlFromEnv, createTempDatabase, type TempDatabase } from '../test/temp-db.js';
import {
  BlobCorruptError,
  BlobTooLargeError,
  BlobsService,
  blobObjectKey,
} from './blobs.service.js';

const adminUrl = adminUrlFromEnv();

const RAW_SECRETS = REDACTION_FIXTURES.flatMap((fixture) => fixture.mustNotContain);
const PROMPT = REDACTION_FIXTURES.map((fixture) => fixture.input).join('\n');

function spansWithSecrets() {
  return otelFixtureSpans().map((span) => {
    const attributes = { ...span.attributes };
    if (attributes['gen_ai.operation.name'] === 'chat') {
      attributes['gen_ai.input.messages'] = JSON.stringify([
        { role: 'user', parts: [{ type: 'text', content: PROMPT }] },
      ]);
    }
    if (attributes['gen_ai.tool.call.result'] !== undefined) {
      attributes['gen_ai.tool.call.result'] =
        `ORBITAL_TOKEN=orb_live_9f3aQ7xLm2 owner=ops@example.com`;
    }
    return { ...span, name: `${span.name} ORBITAL_TOKEN=orb_live_9f3aQ7xLm2`, attributes };
  });
}

describe.skipIf(adminUrl === undefined)('redaction and blobs', () => {
  let temp: TempDatabase;
  let admin: Sql;
  let app: NestFastifyApplication;
  const keys = { off: generateApiKey(), summary: generateApiKey(), on: generateApiKey() };

  beforeAll(async () => {
    temp = await createTempDatabase(adminUrl!);
    await runMigrations({ adminUrl: temp.adminUrl, appRole: temp.role });
    admin = postgres(temp.adminUrl, { max: 1, onnotice: () => undefined });
    await admin.unsafe(
      `INSERT INTO tenants (id, name, capture_mode) VALUES ('t-off', 'Off', 'off'), ('t-summary', 'Summary', 'summary'), ('t-on', 'On', 'on')`,
    );
    await admin.unsafe(
      `INSERT INTO api_keys (id, tenant_id, key_hash, prefix, name) VALUES
       ('k-off', 't-off', '${keys.off.keyHash}', '${keys.off.prefix}', 'off'),
       ('k-summary', 't-summary', '${keys.summary.keyHash}', '${keys.summary.prefix}', 'summary'),
       ('k-on', 't-on', '${keys.on.keyHash}', '${keys.on.prefix}', 'on')`,
    );
    process.env.DATABASE_URL = temp.appUrl;
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await admin.end();
    await temp.drop();
  });

  const post = (url: string, body: unknown, bearer: string): Promise<LightMyRequestResponse> =>
    (app.getHttpAdapter().getInstance() as FastifyInstance).inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify(body),
    });

  const dumpTables = async (tenantId: string): Promise<string> => {
    const events = await admin.unsafe(`SELECT * FROM events WHERE tenant_id = '${tenantId}'`);
    const blobs = await admin.unsafe(`SELECT * FROM blobs WHERE tenant_id = '${tenantId}'`);
    return JSON.stringify({ events, blobs });
  };

  const dumpObjects = async (tenantId: string): Promise<string> => {
    const store = app.get<ObjectStore>(OBJECT_STORE);
    const rows = await admin.unsafe(
      `SELECT storage_key FROM blobs WHERE tenant_id = '${tenantId}'`,
    );
    const bodies: string[] = [];
    for (const row of rows) {
      const stored = await store.get(String(row.storage_key));
      bodies.push(Buffer.from(stored!.body).toString('latin1'));
    }
    return bodies.join('\n');
  };

  it.each(['off', 'summary', 'on'] as const)(
    'stores no raw secret, email or key for capture %s (events, blobs table, and objects inspected)',
    async (mode) => {
      const res = await post('/v1/traces', toOtlpJson(spansWithSecrets()), keys[mode].key);
      expect(res.statusCode, res.body).toBe(200);
      const tenantId = `t-${mode}`;
      const dump = await dumpTables(tenantId);
      for (const secret of RAW_SECRETS) expect(dump, `${mode}: ${secret}`).not.toContain(secret);
      expect(dump).not.toContain('orb_live_9f3aQ7xLm2');
      expect(dump).not.toContain('ops@example.com');
      expect(dump).toContain('[secret:');
      const objects = await dumpObjects(tenantId);
      for (const secret of RAW_SECRETS) expect(objects).not.toContain(secret);
      const events = await app.get(EventsRepository).list(tenantId);
      expect(events.every((event) => event.attrs['debrief.redaction.v'] === 1)).toBe(true);
      const blobs = await admin.unsafe(
        `SELECT count(*)::int AS n FROM blobs WHERE tenant_id = '${tenantId}'`,
      );
      const digests = new Set(events.flatMap((event) => event.payloadSha256 ?? []));
      expect(blobs[0]?.n).toBe(mode === 'on' ? digests.size : 0);
      expect(digests.size > 0).toBe(mode === 'on');
      const withSnippet = events.filter((event) => event.summary?.includes(' · “')).length;
      if (mode === 'off') expect(withSnippet).toBe(0);
      else expect(withSnippet).toBeGreaterThanOrEqual(8);
    },
  );

  it('round-trips a blob and decrypts to the redacted content', async () => {
    const blobs = app.get(BlobsService);
    const events = await app.get(EventsRepository).list('t-on');
    const chat = events.find(
      (event) => event.kind === 'llm.call' && event.payloadSha256 !== undefined,
    )!;
    const fetched = await blobs.get('t-on', chat.payloadSha256!);
    expect(fetched?.blob).toMatchObject({
      tenantId: 't-on',
      sha256: chat.payloadSha256,
      mime: 'application/json',
      encrypted: true,
    });
    const document = JSON.parse(new TextDecoder().decode(fetched!.body)) as {
      content: Record<string, string>;
    };
    const text = document.content['gen_ai.input.messages']!;
    for (const secret of RAW_SECRETS) expect(text).not.toContain(secret);
    expect(text).toContain('[secret:');
    expect(text).toContain('[email:');
    const stored = await app
      .get<ObjectStore>(OBJECT_STORE)
      .get(blobObjectKey('t-on', chat.payloadSha256!));
    expect(Buffer.from(stored!.body).toString('latin1')).not.toContain('[secret:');
    const again = await blobs.put('t-on', fetched!.body, 'application/json');
    expect(again.sha256).toBe(chat.payloadSha256);
    expect(await blobs.get('t-on', 'ab'.repeat(32))).toBeUndefined();
  });

  it('serves a blob to its tenant only, immutable and content-typed', async () => {
    const server = app.getHttpAdapter().getInstance() as FastifyInstance;
    const events = await app.get(EventsRepository).list('t-on');
    const chat = events.find(
      (event) => event.kind === 'llm.call' && event.payloadSha256 !== undefined,
    )!;
    const get = (sha: string, bearer: string): Promise<LightMyRequestResponse> =>
      server.inject({
        method: 'GET',
        url: `/v1/blobs/${sha}`,
        headers: { authorization: `Bearer ${bearer}` },
      });
    const ok = await get(chat.payloadSha256!, keys.on.key);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.headers['content-type']).toContain('application/json');
    expect(ok.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(ok.headers['x-blob-sha256']).toBe(chat.payloadSha256);
    const document = JSON.parse(ok.body) as { content: Record<string, string> };
    expect(document.content['gen_ai.input.messages']).toContain('[secret:');
    for (const secret of RAW_SECRETS) expect(ok.body).not.toContain(secret);
    expect((await get(chat.payloadSha256!, keys.summary.key)).statusCode).toBe(404);
    expect((await get('ab'.repeat(32), keys.on.key)).statusCode).toBe(404);
    expect((await get('nope', keys.on.key)).statusCode).toBe(400);
    expect(
      (await server.inject({ method: 'GET', url: `/v1/blobs/${chat.payloadSha256!}` })).statusCode,
    ).toBe(401);
  });

  it('rejects oversize blobs and detects corrupted objects', async () => {
    const blobs = app.get(BlobsService);
    await expect(
      blobs.put('t-on', new Uint8Array(2 * 1024 * 1024), 'application/octet-stream'),
    ).rejects.toBeInstanceOf(BlobTooLargeError);
    const small = await blobs.put('t-on', new TextEncoder().encode('{"x":1}'), 'application/json');
    const store = app.get<ObjectStore>(OBJECT_STORE);
    const sealed = (await store.get(small.storageKey))!.body;
    const tampered = Uint8Array.from(sealed);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    await store.put(small.storageKey, tampered, 'application/octet-stream');
    await expect(blobs.get('t-on', small.sha256)).rejects.toThrow();
    await store.put(
      small.storageKey,
      seal(new Uint8Array(32), new TextEncoder().encode('{"x":2}'), 'nope'),
      'application/octet-stream',
    );
    await expect(blobs.get('t-on', small.sha256)).rejects.toThrow();
    await store.put(small.storageKey, sealed, 'application/octet-stream');
    expect(new TextDecoder().decode((await blobs.get('t-on', small.sha256))!.body)).toBe('{"x":1}');
    expect(() => open(new Uint8Array(32), new Uint8Array(5), 'x')).toThrow(/too short/);
    expect(BlobCorruptError.name).toBe('BlobCorruptError');
  });

  it('makes plaintext unrecoverable when the tenant data key is destroyed while the chain still verifies', async () => {
    const blobs = app.get(BlobsService);
    const events = await app.get(EventsRepository).list('t-on');
    const withBlob = events.filter((event) => event.payloadSha256 !== undefined);
    expect(withBlob.length).toBeGreaterThan(0);
    await app.get(TenantKeysService).destroy('t-on');
    for (const event of withBlob) {
      await expect(blobs.get('t-on', event.payloadSha256!)).rejects.toBeInstanceOf(
        TenantKeyDestroyedError,
      );
    }
    await expect(
      blobs.put('t-on', new TextEncoder().encode('new'), 'text/plain'),
    ).rejects.toBeInstanceOf(TenantKeyDestroyedError);
    const gone = await (app.getHttpAdapter().getInstance() as FastifyInstance).inject({
      method: 'GET',
      url: `/v1/blobs/${withBlob[0]!.payloadSha256!}`,
      headers: { authorization: `Bearer ${keys.on.key}` },
    });
    expect(gone.statusCode).toBe(410);
    const row = await admin.unsafe(
      `SELECT wrapped_key, destroyed_at FROM tenant_keys WHERE tenant_id = 't-on'`,
    );
    expect(row[0]?.wrapped_key).toBeNull();
    expect(row[0]?.destroyed_at).not.toBeNull();
    const fresh = app.get(TenantKeysService);
    await expect(fresh.keyFor('t-on')).rejects.toBeInstanceOf(TenantKeyDestroyedError);
    const chain = await app.get(EventsRepository).list('t-on');
    expect(verifyChain(chain)).toMatchObject({ ok: true, length: chain.length });
    expect(chain.filter((event) => event.payloadSha256 !== undefined).length).toBe(withBlob.length);
    const more = await post(
      '/v1/events',
      {
        events: [
          {
            sourceTs: '2026-09-17T00:00:11.000Z',
            source: 'api',
            provenance: 'reported',
            runId: '4bf92f3577b34da6a3ce929d0e0e4736',
            kind: 'error',
            actor: { type: 'system', id: 'x' },
            attrs: { note: 'token=orb_live_9f3aQ7xLm2' },
          },
        ],
      },
      keys.on.key,
    );
    expect(more.statusCode).toBe(200);
    const after = await app.get(EventsRepository).list('t-on');
    expect(verifyChain(after)).toMatchObject({ ok: true, length: chain.length + 1 });
    expect(JSON.stringify(after[after.length - 1]!.attrs)).not.toContain('orb_live_9f3aQ7xLm2');
  });
});
