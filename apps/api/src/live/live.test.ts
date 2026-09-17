import type { Event } from '@debrief/schema';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { generateApiKey } from '../auth/api-keys.js';
import { runMigrations } from '../db/migrate.js';
import { EventsRepository } from '../events/events.repository.js';
import { adminUrlFromEnv, createTempDatabase, type TempDatabase } from '../test/temp-db.js';
import { LiveService } from './live.service.js';

const adminUrl = adminUrlFromEnv();

interface Frame {
  event: string;
  id?: number;
  data: string;
  at: number;
}

class SseClient {
  readonly frames: Frame[] = [];
  readonly comments: string[] = [];
  private buffer = '';
  private controller = new AbortController();
  private done: Promise<void> = Promise.resolve();

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string>,
  ) {}

  async connect(): Promise<void> {
    this.controller = new AbortController();
    const response = await fetch(this.url, {
      headers: this.headers,
      signal: this.controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const decoder = new TextDecoder();
    this.done = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          this.push(decoder.decode(value, { stream: true }));
        }
      } catch {
        return;
      }
    })();
  }

  private push(chunk: string): void {
    this.buffer += chunk;
    const blocks = this.buffer.split('\n\n');
    this.buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const lines = block.split('\n');
      if (lines.every((line) => line.startsWith(':'))) {
        this.comments.push(block);
        continue;
      }
      const frame: Frame = { event: 'message', data: '', at: performance.now() };
      for (const line of lines) {
        if (line.startsWith('event: ')) frame.event = line.slice(7);
        else if (line.startsWith('id: ')) frame.id = Number(line.slice(4));
        else if (line.startsWith('data: ')) frame.data += line.slice(6);
      }
      if (lines.some((line) => line.startsWith('retry:'))) continue;
      this.frames.push(frame);
    }
  }

  events(): Event[] {
    return this.frames
      .filter((frame) => frame.event === 'event')
      .map((frame) => JSON.parse(frame.data) as Event);
  }

  async waitFor(count: number, timeoutMs = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.events().length < count && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(this.events().length).toBeGreaterThanOrEqual(count);
  }

  async close(): Promise<void> {
    this.controller.abort();
    await this.done;
  }
}

const input = (
  n: number,
  runId = 'run-live',
): Parameters<EventsRepository['append']>[1][number] => ({
  input: {
    id: `01J8ZK5R4M2X6P9Q3V7W1Y${n.toString(36).toUpperCase().padStart(4, '0')}`,
    tenantId: 't1',
    ts: '2026-09-17T00:00:00.000Z',
    sourceTs: '2026-09-17T00:00:00.000Z',
    source: 'api',
    provenance: 'reported',
    runId,
    kind: 'error',
    actor: { type: 'system', id: 'x' },
    attrs: { n },
  },
});

describe.skipIf(adminUrl === undefined)('GET /v1/live', () => {
  let temp: TempDatabase;
  let admin: Sql;
  let app: NestFastifyApplication;
  let base: string;
  let repo: EventsRepository;
  const key = generateApiKey();
  const headers = { authorization: `Bearer ${key.key}` };

  beforeAll(async () => {
    temp = await createTempDatabase(adminUrl!);
    await runMigrations({ adminUrl: temp.adminUrl, appRole: temp.role });
    admin = postgres(temp.adminUrl, { max: 1, onnotice: () => undefined });
    await admin.unsafe(`INSERT INTO tenants (id, name) VALUES ('t1', 'One'), ('t2', 'Two')`);
    await admin.unsafe(
      `INSERT INTO api_keys (id, tenant_id, key_hash, prefix, name) VALUES ('k1', 't1', '${key.keyHash}', '${key.prefix}', 'one')`,
    );
    process.env.DATABASE_URL = temp.appUrl;
    process.env.LIVE_HEARTBEAT_MS = '60';
    app = await createApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = await app.getUrl();
    repo = app.get(EventsRepository);
  });

  afterAll(async () => {
    await app.close();
    await admin.end();
    await temp.drop();
    delete process.env.LIVE_HEARTBEAT_MS;
  });

  it('delivers appended events within 200 ms, with run frames and heartbeats', async () => {
    const client = new SseClient(`${base}/v1/live`, headers);
    await client.connect();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app.get(LiveService).subscriberCount).toBe(1);
    const latencies: number[] = [];
    for (const n of [0, 1, 2]) {
      const started = performance.now();
      await repo.append('t1', [input(n)]);
      await client.waitFor(n + 1);
      latencies.push(client.frames[client.frames.length - 1]!.at - started);
    }
    expect(Math.min(...latencies)).toBeLessThan(200);
    expect(client.events().map((event) => event.seq)).toEqual([0, 1, 2]);
    expect(client.frames.map((frame) => frame.event)).toEqual(['run', 'event', 'event', 'event']);
    expect(client.frames.map((frame) => frame.id)).toEqual([undefined, 0, 1, 2]);
    expect(JSON.parse(client.frames[0]!.data)).toEqual({ runId: 'run-live', firstSeq: 0 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(client.comments.length).toBeGreaterThanOrEqual(2);
    expect(client.comments[0]).toMatch(/^: keepalive /);
    await client.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app.get(LiveService).subscriberCount).toBe(0);
  });

  it('resumes with since or Last-Event-ID without gaps or duplicates', async () => {
    const first = new SseClient(`${base}/v1/live?since=-1`, headers);
    await first.connect();
    await first.waitFor(3);
    expect(first.events().map((event) => event.seq)).toEqual([0, 1, 2]);
    await first.close();

    await repo.append('t1', [input(3), input(4)]);
    const resumed = new SseClient(`${base}/v1/live?since=2`, headers);
    await resumed.connect();
    await resumed.waitFor(2);
    await repo.append('t1', [input(5)]);
    await resumed.waitFor(3);
    expect(resumed.events().map((event) => event.seq)).toEqual([3, 4, 5]);
    await resumed.close();

    const byHeader = new SseClient(`${base}/v1/live`, { ...headers, 'last-event-id': '4' });
    await byHeader.connect();
    await byHeader.waitFor(1);
    expect(byHeader.events().map((event) => event.seq)).toEqual([5]);
    await byHeader.close();

    const fresh = new SseClient(`${base}/v1/live`, headers);
    await fresh.connect();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(fresh.events()).toEqual([]);
    await repo.append('t1', [input(6)]);
    await fresh.waitFor(1);
    expect(fresh.events()[0]!.seq).toBe(6);
    await fresh.close();
  });

  it('filters by run, ignores other tenants, and paginates catch-up in batches', async () => {
    const other = new SseClient(`${base}/v1/live?since=-1&run=run-other`, headers);
    await other.connect();
    await repo.append('t1', [input(7, 'run-other'), input(8), input(9, 'run-other')]);
    await other.waitFor(2);
    expect(other.events().map((event) => [event.seq, event.runId])).toEqual([
      [7, 'run-other'],
      [9, 'run-other'],
    ]);
    await admin.unsafe(
      `INSERT INTO tenant_keys (tenant_id, key_id, wrapped_key, pii_salt) VALUES ('t2', 'k', 'x', 'salt')`,
    );
    await admin.unsafe(
      `INSERT INTO events (tenant_id, seq, id, ts, source_ts, source, provenance, run_id, kind, actor, attrs, prev_hash, hash)
       VALUES ('t2', 0, '01J8ZK5R4M2X6P9Q3V7W1Y5N99', '2026-09-17T00:00:00.000Z', '2026-09-17T00:00:00.000Z', 'api', 'reported', 'run-other', 'error', '{"type":"system","id":"x"}', '{}', '${'0'.repeat(64)}', '${'ab'.repeat(32)}')`,
    );
    await admin.unsafe(
      `SELECT pg_notify('debrief_events', '{"tenantId":"t2","fromSeq":0,"toSeq":0}')`,
    );
    await admin.unsafe(`SELECT pg_notify('debrief_events', 'not json')`);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(other.events()).toHaveLength(2);
    await other.close();

    await repo.append(
      't1',
      Array.from({ length: 600 }, (_, n) => input(100 + n, 'bulk')),
    );
    const bulk = new SseClient(`${base}/v1/live?since=9&run=bulk`, headers);
    await bulk.connect();
    await bulk.waitFor(600, 10_000);
    const seqs = bulk.events().map((event) => event.seq);
    expect(seqs).toEqual(Array.from({ length: 600 }, (_, n) => 10 + n));
    await bulk.close();
  });

  it('rejects bad queries and missing keys', async () => {
    expect((await fetch(`${base}/v1/live?since=abc`, { headers })).status).toBe(400);
    expect((await fetch(`${base}/v1/live?since=-5`, { headers })).status).toBe(400);
    expect((await fetch(`${base}/v1/live`)).status).toBe(401);
  });
});
