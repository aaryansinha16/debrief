import golden from '@debrief/schema/golden/otel-map.json' with { type: 'json' };
import { otelFixtureSpans } from '@debrief/schema/fixtures';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { generateApiKey } from '../auth/api-keys.js';
import { runMigrations } from '../db/migrate.js';
import { EventsRepository } from '../events/events.repository.js';
import { adminUrlFromEnv, createTempDatabase, type TempDatabase } from '../test/temp-db.js';
import { toOtlpJson, toProtobufObject } from './otlp-json.js';
import { ExportTraceServiceRequest, ExportTraceServiceResponse } from './otlp-proto.js';
import { OtlpService } from './otlp.service.js';
import { PROTOBUF } from './traces.controller.js';

const adminUrl = adminUrlFromEnv();
const spans = otelFixtureSpans();
const json = toOtlpJson(spans);
const expectedInputs = golden.on.events.map((event) => event.input);

describe.skipIf(adminUrl === undefined)('POST /v1/traces', () => {
  let temp: TempDatabase;
  let admin: Sql;
  let app: NestFastifyApplication;
  const offKey = generateApiKey();
  const onKey = generateApiKey();

  beforeAll(async () => {
    temp = await createTempDatabase(adminUrl!);
    await runMigrations({ adminUrl: temp.adminUrl, appRole: temp.role });
    admin = postgres(temp.adminUrl, { max: 1, onnotice: () => undefined });
    await admin.unsafe(
      `INSERT INTO tenants (id, name, capture_mode) VALUES ('t-off', 'Off', 'off'), ('t-on', 'On', 'on')`,
    );
    await admin.unsafe(
      `INSERT INTO api_keys (id, tenant_id, key_hash, prefix, name) VALUES
       ('k-off', 't-off', '${offKey.keyHash}', '${offKey.prefix}', 'off'),
       ('k-on', 't-on', '${onKey.keyHash}', '${onKey.prefix}', 'on')`,
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

  const post = (
    payload: InjectOptions['payload'],
    key: string | undefined,
    contentType = 'application/json',
  ): Promise<LightMyRequestResponse> => {
    const server = app.getHttpAdapter().getInstance() as FastifyInstance;
    const headers: Record<string, string> = { 'content-type': contentType };
    if (key !== undefined) headers.authorization = `Bearer ${key}`;
    return server.inject({ method: 'POST', url: '/v1/traces', headers, payload });
  };

  const stored = async (tenantId: string) => {
    const repo = app.get(EventsRepository);
    return (await repo.list(tenantId, 0, 1000)).map(
      ({ id: _id, ts: _ts, tenantId: _t, seq: _s, prevHash: _p, hash: _h, ...rest }) => rest,
    );
  };

  it('maps the fixture to the golden events, ignoring unknown spans', async () => {
    const res = await post(JSON.stringify(json), offKey.key);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      partialSuccess: {
        rejectedSpans: 0,
        errorMessage: 'ignored 1 span(s) without a gen_ai or mcp operation',
      },
    });
    expect(await stored('t-off')).toEqual(expectedInputs);
    expect(app.get(OtlpService).stats()).toEqual({
      spans: 11,
      accepted: 15,
      duplicates: 0,
      ignored: 1,
    });
  });

  it('stores nothing from content when capture is off', async () => {
    const dump = JSON.stringify(
      await admin.unsafe(`SELECT * FROM events WHERE tenant_id = 't-off'`),
    );
    expect(dump).not.toContain('orb_live_9f3a');
    expect(dump).not.toContain('fix the staging deploy');
    expect(dump).not.toContain('gen_ai.input.messages');
    const blobs = await admin.unsafe(`SELECT count(*)::int AS n FROM blobs`);
    expect(blobs[0]?.n).toBe(0);
  });

  it('is idempotent on replay', async () => {
    const res = await post(JSON.stringify(json), offKey.key);
    expect(res.statusCode).toBe(200);
    expect((await stored('t-off')).length).toBe(15);
    expect(app.get(OtlpService).stats().duplicates).toBe(15);
  });

  it('accepts protobuf and answers in protobuf', async () => {
    const message = ExportTraceServiceRequest.fromObject(toProtobufObject(json));
    const bytes = Buffer.from(ExportTraceServiceRequest.encode(message).finish());
    const res = await post(bytes, onKey.key, PROTOBUF);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toBe(PROTOBUF);
    const decoded = ExportTraceServiceResponse.toObject(
      ExportTraceServiceResponse.decode(res.rawPayload),
      { longs: Number, defaults: true },
    );
    expect(decoded).toEqual({
      partialSuccess: {
        rejectedSpans: 0,
        errorMessage: 'ignored 1 span(s) without a gen_ai or mcp operation',
      },
    });
    expect(await stored('t-on')).toEqual(expectedInputs);
  });

  it('answers an empty object when every span mapped', async () => {
    const known = toOtlpJson(spans.filter((span) => span.spanId !== 'f506172839405162'));
    const res = await post(JSON.stringify(known), onKey.key);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });

  it('rejects bad payloads, bad keys and oversize bodies', async () => {
    expect((await post(JSON.stringify(json), undefined)).statusCode).toBe(401);
    expect((await post('{"resourceSpans": "nope"}', onKey.key)).statusCode).toBe(400);
    expect((await post('not json', onKey.key)).statusCode).toBe(400);
    expect((await post(Buffer.from([0xff, 0xff]), onKey.key, PROTOBUF)).statusCode).toBe(400);
    const huge = JSON.stringify({ resourceSpans: [], pad: 'x'.repeat(8 * 1024 * 1024) });
    expect((await post(huge, onKey.key)).statusCode).toBe(413);
  });
});
