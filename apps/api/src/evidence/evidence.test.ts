import { sha256Hex } from '@debrief/chain';
import { emptySections, unpackBundle, verifyBundle } from '@debrief/evidence';
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import type { Event, EventInput } from '@debrief/schema';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { generateApiKey } from '../auth/api-keys.js';
import { BlobsService } from '../blobs/blobs.service.js';
import { runMigrations } from '../db/migrate.js';
import { EventsRepository } from '../events/events.repository.js';
import { RunsService } from '../runs/runs.service.js';
import { adminUrlFromEnv, createTempDatabase, type TempDatabase } from '../test/temp-db.js';
import { type EvidenceJob, EvidenceService } from './evidence.service.js';

const adminUrl = adminUrlFromEnv();

const toInput = (event: Event): EventInput => {
  const { seq: _seq, prevHash: _prev, hash: _hash, ...rest } = event;
  return { ...rest, tenantId: 't1' };
};

describe.skipIf(adminUrl === undefined)('evidence jobs', () => {
  let temp: TempDatabase;
  let admin: Sql;
  let app: NestFastifyApplication;
  const key = generateApiKey();
  const fixture = demoRunFixture();
  const inRun = fixture.filter((event) => event.runId === DEMO_RUN_ID);
  let sealedSha = '';
  const sealedDocument = new TextEncoder().encode(
    JSON.stringify({
      sourceId: 'span-1',
      content: { 'gen_ai.input.messages': '[secret:1234abcd]' },
    }),
  );

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
    process.env.CHECKPOINT_INTERVAL_MS = '60000';
    app = await createApp();
    await app.init();
    const blob = await app.get(BlobsService).put('t1', sealedDocument, 'application/json');
    sealedSha = blob.sha256;
    const last = inRun.at(-1)!;
    await app.get(EventsRepository).append('t1', [
      ...[...fixture].sort((a, b) => a.seq - b.seq).map((event) => ({ input: toInput(event) })),
      {
        input: {
          ...toInput(last),
          id: '01M2QF4GZZZZZZZZZZZZZZZZZ1',
          sourceTs: '2026-09-17T11:00:01.000Z',
          kind: 'llm.call',
          attrs: {},
          summary: 'one sealed call',
          payloadSha256: sealedSha,
        },
      },
    ]);
    await app.get(RunsService).settle();
  });

  afterAll(async () => {
    await app.close();
    await admin.end();
    await temp.drop();
    delete process.env.RUN_DEBOUNCE_MS;
    delete process.env.CHECKPOINT_INTERVAL_MS;
  });

  const server = (): FastifyInstance => app.getHttpAdapter().getInstance() as FastifyInstance;
  const headers = { authorization: `Bearer ${key.key}`, 'content-type': 'application/json' };
  const post = (url: string, body: unknown = {}): Promise<LightMyRequestResponse> =>
    server().inject({ method: 'POST', url, headers, payload: JSON.stringify(body) });
  const get = (url: string): Promise<LightMyRequestResponse> =>
    server().inject({ method: 'GET', url, headers });
  const sealed = async (body: unknown): Promise<{ job: EvidenceJob; ms: number }> => {
    const started = performance.now();
    const queued = await post(`/v1/runs/${DEMO_RUN_ID}/evidence`, body);
    expect(queued.statusCode, queued.body).toBe(202);
    const { id } = queued.json<EvidenceJob>();
    let job = queued.json<EvidenceJob>();
    for (
      let attempt = 0;
      attempt < 200 && job.status !== 'done' && job.status !== 'failed';
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      job = (await get(`/v1/evidence/${id}`)).json<EvidenceJob>();
    }
    return { job, ms: performance.now() - started };
  };

  it('seals the demo run in under ten seconds and the bundle verifies with the chain package', async () => {
    const { job, ms } = await sealed({});
    expect(job.status, job.error).toBe('done');
    expect(ms).toBeLessThan(10_000);
    expect(job.downloadUrl).toBeDefined();
    expect(job.bytes).toBeGreaterThan(1000);
    expect(job.completedAt).toBeDefined();
    const download = await get(`/v1/evidence/${job.id}/bundle.zip`);
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('application/zip');
    const bytes = new Uint8Array(download.rawPayload);
    expect(bytes.byteLength).toBe(job.bytes);
    const bundle = unpackBundle(bytes);
    const verdict = verifyBundle(bundle);
    expect(verdict.failedAt).toBeUndefined();
    expect(verdict.ok).toBe(true);
    expect(bundle.events).toHaveLength(inRun.length + 1);
    expect(bundle.checkpoints.length).toBeGreaterThanOrEqual(1);
    expect(bundle.proofs.inclusion).toHaveLength(inRun.length + 1);
    expect(bundle.manifest).toMatchObject({
      tenantId: 't1',
      runIds: [DEMO_RUN_ID],
      redaction: { summaries: true, includeContent: false },
    });
    expect(bundle.blobs).toEqual({});
    expect(emptySections(bundle.report)).toEqual([]);
    expect(bundle.report).toContain('## Divergence');
    expect(bundle.report).toContain('prod-destructive-needs-approval');
    expect(bundle.report).toContain('agent: coding-agent · principal: human:aaryan');
    expect(bundle.regulationMap).toMatchObject({ version: '1', wording: 'supports' });
    if (job.downloadUrl?.startsWith('http')) {
      const fetched = await fetch(job.downloadUrl);
      expect(fetched.status).toBe(200);
      expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(bytes);
    }
  });

  it('includes the sealed content when asked, byte for byte', async () => {
    const { job } = await sealed({ includeContent: true, policyId: 'allow-all' });
    expect(job.status, job.error).toBe('done');
    const bundle = unpackBundle(
      new Uint8Array((await get(`/v1/evidence/${job.id}/bundle.zip`)).rawPayload),
    );
    expect(verifyBundle(bundle).ok).toBe(true);
    expect(bundle.manifest.redaction.includeContent).toBe(true);
    expect(Object.keys(bundle.blobs)).toEqual([sealedSha]);
    expect(bundle.files[`blobs/${sealedSha}.json`]).toEqual(sealedDocument);
    expect(sha256Hex(sealedDocument)).toBe(sealedSha);
    expect(bundle.report).toContain('sealed content included');
    expect(bundle.report).toContain(
      'No divergence: the policy would have allowed every recorded action.',
    );
  });

  it('rejects unknown runs, policies and jobs, and refuses a bundle that is not ready', async () => {
    expect((await post('/v1/runs/nope/evidence')).statusCode).toBe(404);
    expect((await post(`/v1/runs/${DEMO_RUN_ID}/evidence`, { policyId: 'nope' })).statusCode).toBe(
      400,
    );
    expect((await post(`/v1/runs/${DEMO_RUN_ID}/evidence`, { other: 1 })).statusCode).toBe(400);
    expect((await get('/v1/evidence/nope')).statusCode).toBe(404);
    expect((await get('/v1/evidence/nope/bundle.zip')).statusCode).toBe(404);
    await app.get(EvidenceService).settle();
  });
});
