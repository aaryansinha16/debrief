import { GENESIS_HASH, hashEvent, verifyChain } from '@debrief/chain';
import { eventSchema, type Event, type EventInput } from '@debrief/schema';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../config/config.js';
import { createDb, createSqlClient, type Db } from '../db/db.module.js';
import { runMigrations } from '../db/migrate.js';
import { TenantKeysService } from '../tenants/tenant-keys.service.js';
import { adminUrlFromEnv, createTempDatabase, type TempDatabase } from '../test/temp-db.js';
import {
  type AppendNotification,
  EVENTS_CHANNEL,
  EventsRepository,
  toEvent,
} from './events.repository.js';

const adminUrl = adminUrlFromEnv();

const ulid = (n: number): string =>
  `01J8ZK5R4M2X6P9Q3V7W1Y${n.toString(36).toUpperCase().padStart(4, '0')}`;

function input(n: number, patch: Partial<EventInput> = {}): EventInput {
  return {
    id: ulid(n),
    tenantId: 'ignored-by-repository',
    ts: '2026-09-17T00:00:00.000Z',
    sourceTs: '2026-09-17T00:00:00.000Z',
    source: 'api',
    provenance: 'reported',
    runId: 'run-1',
    kind: 'agent.invoke',
    actor: { type: 'agent', id: 'agent:a' },
    attrs: { n, 'gen_ai.agent.name': 'a', flag: true },
    ...patch,
  };
}

const percentile = (samples: number[], p: number): number => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0;
};

describe.skipIf(adminUrl === undefined)('EventsRepository', () => {
  let temp: TempDatabase;
  let admin: Sql;
  let client: Sql;
  let db: Db;
  let repo: EventsRepository;

  beforeAll(async () => {
    temp = await createTempDatabase(adminUrl!);
    await runMigrations({ adminUrl: temp.adminUrl, appRole: temp.role });
    admin = postgres(temp.adminUrl, { max: 1, onnotice: () => undefined });
    await admin.unsafe(
      `INSERT INTO tenants (id, name) VALUES ('t1', 'Tenant One'), ('t2', 'Tenant Two')`,
    );
    client = createSqlClient(temp.appUrl);
    db = createDb(client);
    repo = new EventsRepository(
      db,
      new TenantKeysService(loadConfig({ ...process.env, DATABASE_URL: temp.appUrl }), db),
    );
  });

  afterAll(async () => {
    await client.end();
    await admin.end();
    await temp.drop();
  });

  it('assigns seq and hashes from genesis, per tenant', async () => {
    const {
      events: [a0, a1],
      duplicates,
    } = await repo.append('t1', [{ input: input(0) }, { input: input(1) }]);
    expect(duplicates).toBe(0);
    expect(a0).toMatchObject({ tenantId: 't1', seq: 0, prevHash: GENESIS_HASH });
    expect(a1).toMatchObject({ tenantId: 't1', seq: 1, prevHash: a0!.hash });
    expect(a1!.hash).toBe(hashEvent(a0!.hash, a1!));
    expect(eventSchema.safeParse(a1).success).toBe(true);
    const {
      events: [b0],
    } = await repo.append('t2', [{ input: input(0) }]);
    expect(b0).toMatchObject({ tenantId: 't2', seq: 0, prevHash: GENESIS_HASH });
    expect(await repo.append('t1', [])).toEqual({ events: [], duplicates: 0 });
    expect(await repo.head('t1')).toEqual({ seq: 1, hash: a1!.hash });
    expect(await repo.head('none')).toBeUndefined();
  });

  it('round-trips events through the table byte-for-byte for hashing', async () => {
    const full = input(2, {
      spanId: '00f067aa0ba902b7',
      parentSpanId: '53995c3f42cd8ad8',
      authority: {
        principalId: 'human:a',
        scope: ['staging:credentials'],
        permissions: ['account:*'],
      },
      target: {
        system: 'orbital',
        environment: 'production',
        risk: 'critical',
        operation: 'deleteVolume',
      },
      payloadSha256: 'ab'.repeat(32),
      summary: 'unicode ✓ and "quotes" and 1e21',
      attrs: { big: 1e21, small: 1e-7, frac: 0.1 + 0.2, neg: -0, text: 'éé', ok: false },
    });
    const {
      events: [appended],
    } = await repo.append('t1', [{ input: full }]);
    const [fromDb] = await repo.list('t1', appended!.seq, 1);
    expect(fromDb).toEqual({ ...appended, attrs: { ...appended!.attrs, neg: 0 } });
    expect(appended!.attrs['debrief.redaction.v']).toBe(1);
    expect(verifyChain(await repo.list('t1'))).toMatchObject({ ok: true, length: 3 });
  });

  it('strips nulls when mapping rows', () => {
    const row = {
      tenantId: 't',
      seq: 0,
      id: ulid(0),
      ts: 'x',
      sourceTs: 'y',
      source: 'api',
      provenance: 'reported',
      runId: 'r',
      spanId: null,
      parentSpanId: null,
      kind: 'error',
      actor: { type: 'system', id: 's' },
      authority: null,
      target: null,
      attrs: {},
      payloadSha256: null,
      summary: null,
      prevHash: GENESIS_HASH,
      hash: 'ab'.repeat(32),
    } as const;
    expect(Object.keys(toEvent(row)).sort()).toEqual([
      'actor',
      'attrs',
      'hash',
      'id',
      'kind',
      'prevHash',
      'provenance',
      'runId',
      'seq',
      'source',
      'sourceTs',
      'tenantId',
      'ts',
    ]);
  });

  it('notifies listeners with the appended seq range', async () => {
    const listener = createSqlClient(temp.appUrl);
    const payloads: AppendNotification[] = [];
    await listener.listen(EVENTS_CHANNEL, (payload) => {
      payloads.push(JSON.parse(payload) as AppendNotification);
    });
    const { events: appended } = await repo.append('t2', [
      { input: input(1) },
      { input: input(2) },
    ]);
    await expect.poll(() => payloads).toEqual([{ tenantId: 't2', fromSeq: 1, toSeq: 2 }]);
    expect(appended.map((event) => event.seq)).toEqual([1, 2]);
    await listener.end();
  });

  it('serializes 1,000 concurrent appends into a gap-free, verifiable chain', async () => {
    await admin.unsafe(`INSERT INTO tenants (id, name) VALUES ('t3', 'Tenant Three')`);
    const results = await Promise.all(
      Array.from({ length: 1000 }, (_, n) =>
        repo.append('t3', [{ input: input(n, { runId: `run-${String(n % 7)}` }) }]),
      ),
    );
    const seqs = results.map(({ events: [event] }) => event!.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 1000 }, (_, i) => i));
    const stored: Event[] = [];
    for await (const event of repo.scan('t3', 256)) stored.push(event);
    expect(stored).toHaveLength(1000);
    expect(verifyChain(stored)).toEqual({ ok: true, length: 1000, headHash: stored[999]!.hash });
    expect(new Set(stored.map((event) => event.id)).size).toBe(1000);
  }, 120_000);

  it('appends with p99 latency under budget', async () => {
    await admin.unsafe(`INSERT INTO tenants (id, name) VALUES ('t4', 'Tenant Four')`);
    for (let n = 0; n < 50; n += 1) await repo.append('t4', [{ input: input(n) }]);
    const samples: number[] = [];
    for (let n = 50; n < 1050; n += 1) {
      const started = performance.now();
      await repo.append('t4', [{ input: input(n) }]);
      samples.push(performance.now() - started);
    }
    const p99 = percentile(samples, 0.99);
    const budget = process.env.CI === undefined ? 15 : 60;
    process.stdout.write(
      `append p50=${percentile(samples, 0.5).toFixed(2)}ms p99=${p99.toFixed(2)}ms\n`,
    );
    expect(p99).toBeLessThan(budget);
    expect(verifyChain(await repo.list('t4', 0, 2000))).toMatchObject({ ok: true, length: 1050 });
  }, 120_000);

  it('skips items whose (source, sourceId) was already stored, within and across batches', async () => {
    await admin.unsafe(`INSERT INTO tenants (id, name) VALUES ('t5', 'Tenant Five')`);
    const first = await repo.append('t5', [
      { input: input(0), sourceId: 'trace:a' },
      { input: input(1), sourceId: 'trace:b' },
      { input: input(2), sourceId: 'trace:a' },
      { input: input(3) },
    ]);
    expect(first.events.map((event) => event.seq)).toEqual([0, 1, 2]);
    expect(first.duplicates).toBe(1);
    const replay = await repo.append('t5', [
      { input: input(4), sourceId: 'trace:a' },
      { input: input(5), sourceId: 'trace:b' },
    ]);
    expect(replay).toEqual({ events: [], duplicates: 2 });
    const otherSource = await repo.append('t5', [
      { input: input(6, { source: 'mcp-proxy' }), sourceId: 'trace:a' },
    ]);
    expect(otherSource.events.map((event) => event.seq)).toEqual([3]);
    expect(await repo.head('t5')).toMatchObject({ seq: 3 });
    const rows = await admin.unsafe(
      `SELECT source, source_id, seq FROM event_sources WHERE tenant_id = 't5' ORDER BY seq`,
    );
    expect(rows.map((row) => [String(row.source), String(row.source_id), Number(row.seq)])).toEqual(
      [
        ['api', 'trace:a', 0],
        ['api', 'trace:b', 1],
        ['mcp-proxy', 'trace:a', 3],
      ],
    );
  });

  it('rejects a duplicate event id within a tenant', async () => {
    await expect(repo.append('t1', [{ input: input(0) }])).rejects.toMatchObject({
      cause: { code: '23505' },
    });
    expect(await repo.head('t1')).toMatchObject({ seq: 2 });
  });
});
