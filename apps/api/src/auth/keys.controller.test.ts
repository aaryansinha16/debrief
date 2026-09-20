import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { runMigrations } from '../db/migrate.js';
import { adminUrlFromEnv, createTempDatabase, type TempDatabase } from '../test/temp-db.js';
import { generateApiKey } from './api-keys.js';

const adminUrl = adminUrlFromEnv();

interface Issued {
  id: string;
  prefix: string;
  name: string;
  key: string;
  createdAt: string;
  revokedAt: string | null;
  rotatedFrom?: string;
}

describe.skipIf(adminUrl === undefined)('/v1/keys', () => {
  let temp: TempDatabase;
  let admin: Sql;
  let app: NestFastifyApplication;
  const first = generateApiKey();
  const other = generateApiKey();

  beforeAll(async () => {
    temp = await createTempDatabase(adminUrl!);
    await runMigrations({ adminUrl: temp.adminUrl, appRole: temp.role });
    admin = postgres(temp.adminUrl, { max: 1, onnotice: () => undefined });
    await admin.unsafe(
      `INSERT INTO tenants (id, name, capture_mode) VALUES ('t1', 'One', 'on'), ('t2', 'Two', 'on')`,
    );
    await admin.unsafe(
      `INSERT INTO api_keys (id, tenant_id, key_hash, prefix, name) VALUES
       ('k-first', 't1', '${first.keyHash}', '${first.prefix}', 'first'),
       ('k-other', 't2', '${other.keyHash}', '${other.prefix}', 'other')`,
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

  const call = async (
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    key: string,
    body?: unknown,
  ): Promise<LightMyRequestResponse> => {
    const server = app.getHttpAdapter().getInstance() as FastifyInstance;
    return server.inject({
      method,
      url,
      headers: { authorization: `Bearer ${key}` },
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    });
  };

  it('lists the tenant keys and marks the caller', async () => {
    const res = await call('GET', '/v1/keys', first.key);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      keys: [
        {
          id: 'k-first',
          prefix: first.prefix,
          name: 'first',
          createdAt: expect.any(String) as string,
          revokedAt: null,
          current: true,
        },
      ],
    });
    expect(res.headers['x-ratelimit-limit']).toBe('30');
  });

  it('creates a key, showing the secret once', async () => {
    const res = await call('POST', '/v1/keys', first.key, { name: 'ci' });
    expect(res.statusCode).toBe(201);
    const issued = res.json<Issued>();
    expect(issued.key).toMatch(/^dbf_/);
    expect(issued.prefix).toBe(issued.key.slice(0, 12));
    expect(issued.name).toBe('ci');
    expect((await call('GET', '/v1/me', issued.key)).json()).toMatchObject({ tenantId: 't1' });
    const listed = (await call('GET', '/v1/keys', first.key)).json<{ keys: Issued[] }>();
    expect(listed.keys.map((key) => key.name)).toEqual(['first', 'ci']);
    expect(listed.keys.some((key) => 'key' in key)).toBe(false);
    expect((await call('POST', '/v1/keys', first.key, { name: '' })).statusCode).toBe(400);
    expect((await call('POST', '/v1/keys', first.key, { nope: 1 })).statusCode).toBe(400);
  });

  it('rotates a key: the old one stops working immediately, the new one carries the name', async () => {
    const created = (
      await call('POST', '/v1/keys', first.key, { name: 'rotating' })
    ).json<Issued>();
    expect((await call('GET', '/v1/me', created.key)).statusCode).toBe(200);
    const res = await call('POST', `/v1/keys/${created.id}/rotate`, created.key);
    expect(res.statusCode).toBe(201);
    const rotated = res.json<Issued>();
    expect(rotated.rotatedFrom).toBe(created.id);
    expect(rotated.name).toBe('rotating');
    expect(rotated.id).not.toBe(created.id);
    expect((await call('GET', '/v1/me', created.key)).statusCode).toBe(401);
    expect((await call('GET', '/v1/me', rotated.key)).json()).toMatchObject({
      keyId: rotated.id,
      tenantId: 't1',
    });
    expect((await call('POST', `/v1/keys/${created.id}/rotate`, first.key)).statusCode).toBe(404);
    expect((await call('POST', '/v1/keys/k-other/rotate', first.key)).statusCode).toBe(404);
    expect((await call('GET', '/v1/me', other.key)).statusCode).toBe(200);
  });

  it('revokes a key but never the last active one', async () => {
    const spare = (await call('POST', '/v1/keys', first.key, { name: 'spare' })).json<Issued>();
    expect((await call('DELETE', `/v1/keys/${spare.id}`, first.key)).statusCode).toBe(204);
    expect((await call('GET', '/v1/me', spare.key)).statusCode).toBe(401);
    expect((await call('DELETE', `/v1/keys/${spare.id}`, first.key)).statusCode).toBe(404);
    expect((await call('DELETE', '/v1/keys/k-first', other.key)).statusCode).toBe(404);
    expect((await call('DELETE', '/v1/keys/k-other', other.key)).statusCode).toBe(409);
    expect((await call('GET', '/v1/me', other.key)).statusCode).toBe(200);
  });
});
