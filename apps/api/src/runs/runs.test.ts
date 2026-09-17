import { otelFixtureSpans } from '@debrief/schema/fixtures';
import type { Event, Run } from '@debrief/schema';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { generateApiKey } from '../auth/api-keys.js';
import { runMigrations } from '../db/migrate.js';
import { EventsRepository } from '../events/events.repository.js';
import { toOtlpJson } from '../otlp/otlp-json.js';
import { adminUrlFromEnv, createTempDatabase, type TempDatabase } from '../test/temp-db.js';
import type { EventsPage } from './runs.controller.js';
import { type RunPage, decodeRunCursor, encodeRunCursor } from './runs.repository.js';
import { RunsService } from './runs.service.js';

const adminUrl = adminUrlFromEnv();
const RUN = '4bf92f3577b34da6a3ce929d0e0e4736';

const native = (n: number, patch: Record<string, unknown>) => ({
  sourceTs: '2026-09-17T00:00:00.000Z',
  source: 'api',
  provenance: 'reported',
  runId: RUN,
  actor: { type: 'human', id: 'human:aaryan', name: 'Aaryan' },
  attrs: { n },
  sourceId: `native:${String(n)}`,
  ...patch,
});

describe.skipIf(adminUrl === undefined)('runs read api', () => {
  let temp: TempDatabase;
  let admin: Sql;
  let app: NestFastifyApplication;
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
    process.env.RUN_DEBOUNCE_MS = '20';
    app = await createApp();
    await app.init();
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

  it('materializes the demo-shaped run with correct counts and riskMax critical', async () => {
    expect((await get(`/v1/runs/${RUN}`)).statusCode).toBe(404);
    const session = await post('/v1/events', {
      events: [
        native(0, { kind: 'principal.session', summary: 'session start' }),
        native(1, {
          kind: 'delegation.grant',
          authority: {
            principalId: 'human:aaryan',
            scope: ['staging:credentials'],
            permissions: ['account:*'],
          },
        }),
      ],
    });
    expect(session.statusCode, session.body).toBe(200);
    expect((await post('/v1/traces', toOtlpJson(otelFixtureSpans()))).statusCode).toBe(200);
    const change = await post('/v1/events', {
      events: [
        native(2, {
          kind: 'world.change',
          source: 'world-hook',
          provenance: 'observed',
          actor: { type: 'system', id: 'orbital-infra' },
          target: {
            system: 'orbital',
            resource: 'projects/nova/volumes/vol-prod-01',
            environment: 'production',
            operation: 'deleteVolume',
            risk: 'critical',
          },
        }),
      ],
    });
    expect(change.statusCode, change.body).toBe(200);
    await app.get(RunsService).settle();
    const res = await get(`/v1/runs/${RUN}`);
    expect(res.statusCode, res.body).toBe(200);
    const run = res.json<Run>();
    expect(run).toMatchObject({
      id: RUN,
      tenantId: 't1',
      principalId: 'human:aaryan',
      agentName: 'coding-agent',
      eventCount: 18,
      status: 'ended',
      riskMax: 'critical',
      divergenceCount: 0,
      graphVersion: 0,
    });
    expect(run.startedAt <= run.endedAt!).toBe(true);
    const listed = (await get('/v1/runs')).json<RunPage>();
    expect(listed.runs.map((r) => r.id)).toEqual([RUN]);
    expect(listed.nextCursor).toBeUndefined();
  });

  it('updates counts after more ingest and computes divergences from policy decisions', async () => {
    await post('/v1/events', {
      events: [
        native(3, {
          kind: 'policy.decision',
          actor: { type: 'system', id: 'debrief-mcp-proxy' },
          attrs: { 'policy.effect': 'deny', 'policy.rule.id': 'r' },
        }),
        native(4, {
          kind: 'policy.decision',
          actor: { type: 'system', id: 'debrief-mcp-proxy' },
          attrs: { 'policy.effect': 'allow' },
        }),
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await app.get(RunsService).settle();
    const run = (await get(`/v1/runs/${RUN}`)).json<Run>();
    expect(run.eventCount).toBe(20);
    expect(run.divergenceCount).toBe(1);
  });

  it('materializes on demand for a run that only has events', async () => {
    await post('/v1/events', {
      events: [
        native(5, { runId: 'other-run', kind: 'error', actor: { type: 'system', id: 'x' } }),
      ],
    });
    await admin.unsafe(`DELETE FROM runs WHERE id = 'other-run'`);
    await app.get(RunsService).settle();
    await admin.unsafe(`DELETE FROM runs WHERE id = 'other-run'`);
    const run = (await get('/v1/runs/other-run')).json<Run>();
    expect(run).toMatchObject({
      id: 'other-run',
      eventCount: 1,
      status: 'active',
      principalId: 'unknown',
      agentName: 'unknown',
    });
    expect(run).not.toHaveProperty('riskMax');
    expect(run).not.toHaveProperty('endedAt');
  });

  it('pages runs newest first with a stable cursor and honours since', async () => {
    for (let n = 0; n < 5; n += 1) {
      await post('/v1/events', {
        events: [
          native(10 + n, {
            runId: `run-${String(n)}`,
            kind: 'error',
            actor: { type: 'system', id: 'x' },
          }),
        ],
      });
    }
    await app.get(RunsService).settle();
    const first = (await get('/v1/runs?limit=3')).json<RunPage>();
    expect(first.runs).toHaveLength(3);
    expect(first.nextCursor).toBeDefined();
    const second = (await get(`/v1/runs?limit=3&cursor=${first.nextCursor!}`)).json<RunPage>();
    const third =
      second.nextCursor === undefined
        ? { runs: [] }
        : (await get(`/v1/runs?limit=3&cursor=${second.nextCursor}`)).json<RunPage>();
    const ids = [...first.runs, ...second.runs, ...third.runs].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(7);
    const startedAts = [...first.runs, ...second.runs, ...third.runs].map((r) => r.startedAt);
    expect([...startedAts].sort().reverse()).toEqual(startedAts);
    const since = (
      await get(`/v1/runs?since=${encodeURIComponent(first.runs[2]!.startedAt)}`)
    ).json<RunPage>();
    expect(since.runs.length).toBeGreaterThanOrEqual(3);
    expect((await get('/v1/runs?cursor=***')).statusCode).toBe(400);
    expect((await get('/v1/runs?limit=0')).statusCode).toBe(400);
    expect((await get('/v1/runs?since=yesterday')).statusCode).toBe(400);
    expect(decodeRunCursor(encodeRunCursor({ startedAt: 'a', id: 'b' }))).toEqual({
      startedAt: 'a',
      id: 'b',
    });
    expect(decodeRunCursor(Buffer.from('nope').toString('base64url'))).toBeUndefined();
  });

  it('pages a run’s events by seq, stable under concurrent ingest', async () => {
    const repo = app.get(EventsRepository);
    const appender = (async () => {
      for (let n = 0; n < 60; n += 1) {
        await post('/v1/events', {
          events: [
            native(100 + n, {
              kind: 'error',
              actor: { type: 'system', id: 'x' },
              sourceId: `race:${String(n)}`,
            }),
          ],
        });
      }
    })();
    const seen: Event[] = [];
    let cursor: string | undefined;
    for (;;) {
      const url =
        cursor === undefined
          ? `/v1/runs/${RUN}/events?limit=7`
          : `/v1/runs/${RUN}/events?limit=7&cursor=${cursor}`;
      const page = (await get(url)).json<EventsPage>();
      seen.push(...page.events);
      if (page.nextCursor === undefined) break;
      cursor = page.nextCursor;
    }
    await appender;
    const all = await repo.listByRun('t1', RUN, 0, undefined, 10_000);
    const seqs = seen.map((event) => event.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs).toEqual(all.slice(0, seqs.length).map((event) => event.seq));
    const lastSeen = Buffer.from(String(seqs[seqs.length - 1]), 'utf8').toString('base64url');
    const tail = (
      await get(`/v1/runs/${RUN}/events?limit=1000&cursor=${lastSeen}`)
    ).json<EventsPage>();
    expect([...seqs, ...tail.events.map((event) => event.seq)]).toEqual(
      all.map((event) => event.seq),
    );
    expect(all).toHaveLength(80);
  });

  it('supports from/to windows and rejects bad queries', async () => {
    const window = (await get(`/v1/runs/${RUN}/events?from=3&to=5`)).json<EventsPage>();
    expect(window.events.map((event) => event.seq)).toEqual([3, 4, 5]);
    expect(window.nextCursor).toBeUndefined();
    expect((await get(`/v1/runs/${RUN}/events?from=5&to=3`)).statusCode).toBe(400);
    expect((await get(`/v1/runs/${RUN}/events?cursor=***`)).statusCode).toBe(400);
    expect((await get(`/v1/runs/${RUN}/events?limit=0`)).statusCode).toBe(400);
    expect((await get('/v1/runs/nope/events')).statusCode).toBe(404);
    expect((await get(`/v1/runs/${RUN}/events?from=999999`)).json<EventsPage>().events).toEqual([]);
    expect((await server().inject({ method: 'GET', url: '/v1/runs' })).statusCode).toBe(401);
  });
});
