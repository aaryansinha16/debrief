import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { generateApiKey } from './auth/api-keys.js';
import { runMigrations } from './db/migrate.js';
import { adminUrlFromEnv, createTempDatabase, type TempDatabase } from './test/temp-db.js';

const adminUrl = adminUrlFromEnv();

describe.skipIf(adminUrl === undefined)('api', () => {
  let temp: TempDatabase;
  let admin: Sql;
  let app: NestFastifyApplication;
  const live = generateApiKey();
  const revoked = generateApiKey();

  beforeAll(async () => {
    temp = await createTempDatabase(adminUrl!);
    await runMigrations({ adminUrl: temp.adminUrl, appRole: temp.role });
    admin = postgres(temp.adminUrl, { max: 1, onnotice: () => undefined });
    await admin.unsafe(
      `INSERT INTO tenants (id, name, capture_mode) VALUES ('t1', 'Tenant One', 'summary')`,
    );
    await admin.unsafe(
      `INSERT INTO api_keys (id, tenant_id, key_hash, prefix, name, revoked_at) VALUES
       ('k-live', 't1', '${live.keyHash}', '${live.prefix}', 'live', NULL),
       ('k-revoked', 't1', '${revoked.keyHash}', '${revoked.prefix}', 'revoked', now())`,
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

  const get = async (url: string, authorization?: string): Promise<LightMyRequestResponse> => {
    const server = app.getHttpAdapter().getInstance() as FastifyInstance;
    return server.inject({
      method: 'GET',
      url,
      headers: authorization === undefined ? {} : { authorization },
    });
  };

  it('serves healthz and readyz without a key', async () => {
    const healthz = await get('/healthz');
    expect(healthz.statusCode).toBe(200);
    expect(healthz.json()).toEqual({ status: 'ok' });
    const readyz = await get('/readyz');
    expect(readyz.statusCode).toBe(200);
  });

  it('rejects missing, malformed, unknown and revoked keys', async () => {
    for (const authorization of [
      undefined,
      'Bearer nope',
      `Bearer ${generateApiKey().key}`,
      `Bearer ${revoked.key}`,
      `Basic ${live.key}`,
    ]) {
      const res = await get('/v1/me', authorization);
      expect(res.statusCode, authorization ?? 'no header').toBe(401);
    }
  });

  it('resolves a live key to its tenant', async () => {
    const res = await get('/v1/me', `Bearer ${live.key}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ keyId: 'k-live', tenantId: 't1', captureMode: 'summary' });
  });
});
