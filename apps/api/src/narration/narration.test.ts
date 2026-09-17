import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import type { Event, EventInput } from '@debrief/schema';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { generateApiKey } from '../auth/api-keys.js';
import { runMigrations } from '../db/migrate.js';
import { EventsRepository } from '../events/events.repository.js';
import { RunsService } from '../runs/runs.service.js';
import { adminUrlFromEnv, createTempDatabase, type TempDatabase } from '../test/temp-db.js';
import type { NarrativeResponse } from './narration.service.js';

const adminUrl = adminUrlFromEnv();

const toInput = (event: Event): EventInput => {
  const { seq: _seq, prevHash: _prev, hash: _hash, ...rest } = event;
  return { ...rest, tenantId: 't1' };
};

interface ModelRequest {
  system?: string;
  messages: { role: string; content: string }[];
  thinking?: { type: string };
  model: string;
}

describe.skipIf(adminUrl === undefined)('POST /v1/runs/:id/narrative', () => {
  let temp: TempDatabase;
  let admin: Sql;
  let app: NestFastifyApplication;
  let model: Server;
  const key = generateApiKey();
  const fixture = demoRunFixture();
  const inRun = fixture.filter((event) => event.runId === DEMO_RUN_ID);
  const requests: ModelRequest[] = [];
  const answers: string[] = [];
  const cited = (count: number): string =>
    JSON.stringify({
      sentences: Array.from({ length: count }, (_, index) => ({
        text: `Sentence ${String(index + 1)} of the debrief.`,
        eventIds: [inRun[index]!.id, inRun[index + 1]!.id],
      })),
    });

  beforeAll(async () => {
    temp = await createTempDatabase(adminUrl!);
    await runMigrations({ adminUrl: temp.adminUrl, appRole: temp.role });
    admin = postgres(temp.adminUrl, { max: 1, onnotice: () => undefined });
    await admin.unsafe(`INSERT INTO tenants (id, name) VALUES ('t1', 'One')`);
    await admin.unsafe(
      `INSERT INTO api_keys (id, tenant_id, key_hash, prefix, name) VALUES ('k1', 't1', '${key.keyHash}', '${key.prefix}', 'one')`,
    );
    model = createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        body += chunk;
      });
      req.on('end', () => {
        requests.push(JSON.parse(body) as ModelRequest);
        const text = answers.shift() ?? cited(6);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: `msg_${String(requests.length)}`,
            type: 'message',
            role: 'assistant',
            model: 'claude-opus-5-test',
            content: [{ type: 'text', text }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => {
      model.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${String((model.address() as AddressInfo).port)}`;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.DATABASE_URL = temp.appUrl;
    process.env.RUN_DEBOUNCE_MS = '20';
    app = await createApp();
    await app.init();
    await app.get(EventsRepository).append(
      't1',
      [...fixture].sort((a, b) => a.seq - b.seq).map((event) => ({ input: toInput(event) })),
    );
    await app.get(RunsService).settle();
  });

  afterAll(async () => {
    await app.close();
    await admin.end();
    await temp.drop();
    model.close();
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.RUN_DEBOUNCE_MS;
  });

  const server = (): FastifyInstance => app.getHttpAdapter().getInstance() as FastifyInstance;
  const post = (url: string): Promise<LightMyRequestResponse> =>
    server().inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json' },
      payload: '{}',
    });
  let appended = 0;
  const appendToRun = async (summary: string): Promise<void> => {
    const last = inRun.at(-1)!;
    appended += 1;
    await app.get(EventsRepository).append('t1', [
      {
        input: {
          ...toInput(last),
          id: `01M2QF4GZZZZZZZZZZZZZZZZ${String(appended)}`,
          sourceTs: `2026-09-17T11:00:0${String(appended)}.000Z`,
          summary,
          kind: 'agent.message',
          attrs: {},
        },
      },
    ]);
    await app.get(RunsService).settle();
  };

  it('narrates the demo run with at least five cited sentences and serves the second call from cache', async () => {
    const first = await post(`/v1/runs/${DEMO_RUN_ID}/narrative`);
    expect(first.statusCode, first.body).toBe(200);
    const narrative = first.json<NarrativeResponse>();
    expect(narrative.cached).toBe(false);
    expect(narrative.model).toBe('claude-opus-5-test');
    expect(narrative.sentences.length).toBeGreaterThanOrEqual(5);
    const ids = new Set(inRun.map((event) => event.id));
    for (const sentence of narrative.sentences) {
      expect(sentence.text.length).toBeGreaterThan(0);
      expect(sentence.eventIds.length).toBeGreaterThan(0);
      expect(sentence.eventIds.every((id) => ids.has(id))).toBe(true);
    }
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.model).toBe('claude-opus-5');
    expect(request.thinking).toEqual({ type: 'adaptive' });
    expect(request.system).toContain('Every sentence must rest on specific events');
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0]?.content).toContain(inRun[0]!.id);
    expect(request.messages[0]?.content).not.toContain('payloadSha256');
    expect(request.messages[0]?.content).not.toContain(fixture[0]!.hash);

    const second = await post(`/v1/runs/${DEMO_RUN_ID}/narrative`);
    expect(second.statusCode).toBe(200);
    const again = second.json<NarrativeResponse>();
    expect(again.cached).toBe(true);
    expect(again.sentences).toEqual(narrative.sentences);
    expect(again.eventsHash).toBe(narrative.eventsHash);
    expect(requests).toHaveLength(1);
    const rows = await admin.unsafe(`SELECT count(*)::int AS n FROM narratives`);
    expect(rows[0]?.n).toBe(1);
  });

  it('narrates again once the run grows, and sends a rejected answer back once with its problems', async () => {
    await appendToRun('the agent said one more thing');
    const uncited = JSON.stringify({
      sentences: [
        { text: 'One.', eventIds: [inRun[0]!.id] },
        { text: 'Two.', eventIds: [] },
        { text: 'Three.', eventIds: ['not-an-event'] },
        { text: 'Four.', eventIds: [inRun[3]!.id] },
        { text: 'Five.', eventIds: [inRun[4]!.id] },
      ],
    });
    answers.push(uncited, cited(5));
    const response = await post(`/v1/runs/${DEMO_RUN_ID}/narrative`);
    expect(response.statusCode, response.body).toBe(200);
    const narrative = response.json<NarrativeResponse>();
    expect(narrative.cached).toBe(false);
    expect(narrative.sentences).toHaveLength(5);
    expect(requests).toHaveLength(3);
    const retry = requests[2]!;
    expect(retry.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(retry.messages[1]?.content).toBe(uncited);
    expect(retry.messages[2]?.content).toContain('- sentence 2 cites no events');
    expect(retry.messages[2]?.content).toContain('- sentence 3 cites unknown events: not-an-event');
    const rows = await admin.unsafe(`SELECT count(*)::int AS n FROM narratives`);
    expect(rows[0]?.n).toBe(2);
  });

  it('refuses a narrative that is still uncited after the retry and caches nothing', async () => {
    await appendToRun('and another');
    answers.push('I would rather write prose than JSON.', cited(3));
    const response = await post(`/v1/runs/${DEMO_RUN_ID}/narrative`);
    expect(response.statusCode).toBe(502);
    expect(response.json<{ message: string }>().message).toContain('only 3 sentences');
    expect(requests).toHaveLength(5);
    expect(requests[4]?.messages[2]?.content).toContain('not the JSON shape requested');
    const rows = await admin.unsafe(`SELECT count(*)::int AS n FROM narratives`);
    expect(rows[0]?.n).toBe(2);
    const later = await post(`/v1/runs/${DEMO_RUN_ID}/narrative`);
    expect(later.statusCode).toBe(200);
    expect(requests).toHaveLength(6);
  });

  it('answers 404 for an unknown run and 503 without a key', async () => {
    expect((await post('/v1/runs/nope/narrative')).statusCode).toBe(404);
    delete process.env.ANTHROPIC_API_KEY;
    const bare = await createApp();
    await bare.init();
    try {
      const response = await (bare.getHttpAdapter().getInstance() as FastifyInstance).inject({
        method: 'POST',
        url: `/v1/runs/${DEMO_RUN_ID}/narrative`,
        headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json' },
        payload: '{}',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<NarrativeResponse>().cached).toBe(true);
      await appendToRun('one more, unnarrated');
      const fresh = await (bare.getHttpAdapter().getInstance() as FastifyInstance).inject({
        method: 'POST',
        url: `/v1/runs/${DEMO_RUN_ID}/narrative`,
        headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json' },
        payload: '{}',
      });
      expect(fresh.statusCode).toBe(503);
      expect(fresh.json<{ message: string }>().message).toContain('ANTHROPIC_API_KEY');
    } finally {
      await bare.close();
      process.env.ANTHROPIC_API_KEY = 'test-key';
    }
  });
});
