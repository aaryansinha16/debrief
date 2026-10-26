import { type Server, createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { generateApiKey } from '../auth/api-keys.js';
import { runMigrations } from '../db/migrate.js';
import { adminUrlFromEnv, createTempDatabase, type TempDatabase } from '../test/temp-db.js';

const adminUrl = adminUrlFromEnv();

interface ModelCall {
  headers: IncomingHttpHeaders;
  body: {
    system: string;
    fallbacks?: unknown;
    output_config: { effort: string; format: unknown };
    messages: { content: string }[];
  };
}

const message = (runId: string, n: number, who: 'human' | 'agent', text: string) => ({
  source: 'api',
  provenance: 'reported',
  kind: 'agent.message',
  runId,
  sourceId: `${runId}:${String(n)}`,
  sourceTs: `2026-10-26T09:15:0${String(n)}.000Z`,
  actor: who === 'human' ? { type: 'human', id: 'user' } : { type: 'agent', id: 'claude-code' },
  attrs: {},
  summary: who === 'human' ? 'user message' : 'assistant message',
  content: { [who === 'human' ? 'gen_ai.input.messages' : 'gen_ai.output.messages']: text },
});

const said = (
  messageId: string,
  quote: string,
  predicate: string,
  params: Record<string, string> = {},
) => ({
  message_id: messageId,
  quote,
  modality: 'asserted',
  predicate,
  subject: { system: 'github', resource: null, environment: null, operation: null },
  params: Object.entries(params).map(([name, value]) => ({ name, value })),
});

describe.skipIf(adminUrl === undefined)('POST /v1/runs/:id/claims', () => {
  let temp: TempDatabase;
  let admin: Sql;
  let app: NestFastifyApplication;
  let model: Server;
  const key = generateApiKey();
  const calls: ModelCall[] = [];
  const answers: string[] = [];

  beforeAll(async () => {
    temp = await createTempDatabase(adminUrl!);
    await runMigrations({ adminUrl: temp.adminUrl, appRole: temp.role });
    admin = postgres(temp.adminUrl, { max: 1, onnotice: () => undefined });
    await admin.unsafe(`INSERT INTO tenants (id, name, capture_mode) VALUES ('t1', 'One', 'on')`);
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
        calls.push({ headers: req.headers, body: JSON.parse(body) as ModelCall['body'] });
        const text = answers.shift() ?? '{"claims":[]}';
        if (text === 'refuse-400') {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              type: 'error',
              error: { type: 'invalid_request_error', message: 'no' },
            }),
          );
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: `msg_${String(calls.length)}`,
            type: 'message',
            role: 'assistant',
            model: 'claude-opus-5-5-test',
            content: [{ type: 'text', text }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${String((model.address() as AddressInfo).port)}`;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.CLAIMS_MAX_CHARS = '6000';
    process.env.DATABASE_URL = temp.appUrl;
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await admin.end();
    await temp.drop();
    model.close();
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAIMS_MAX_CHARS;
  });

  const inject = (target: NestFastifyApplication, url: string, payload?: unknown) =>
    (target.getHttpAdapter().getInstance() as FastifyInstance).inject({
      method: 'POST',
      url,
      headers:
        payload === undefined
          ? { authorization: `Bearer ${key.key}` }
          : { authorization: `Bearer ${key.key}`, 'content-type': 'application/json' },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
  const ingest = async (...events: unknown[]): Promise<string[]> =>
    (await inject(app, '/v1/events', { events }))
      .json<{ events: { id: string }[] }>()
      .events.map((e) => e.id);
  const claimsOf = (run: string): Promise<LightMyRequestResponse> =>
    inject(app, `/v1/runs/${run}/claims`);
  const stored = (run: string) =>
    admin<{ provenance: string; attrs: Record<string, string | number> }[]>`
      SELECT provenance, attrs FROM events WHERE tenant_id = 't1' AND run_id = ${run} AND kind = 'claim' ORDER BY seq`;

  it('extracts once per transcript, appends derived claims that re-read, then serves the cache', async () => {
    const [, m1, m2] = await ingest(
      message('s1', 1, 'human', 'Ship the fix, my email is ana@corp.invalid'),
      message('s1', 2, 'agent', 'All 142 tests pass. I think staging is fine.'),
      message('s1', 3, 'agent', 'Opened PR #311 with the fix.'),
    );
    answers.push(
      JSON.stringify({
        claims: [
          said(m1!, 'All 142 tests pass.', 'tests.passed', { passed: '142' }),
          said(m1!, 'I think staging is fine.', 'db.scope'),
          said(m2!, 'Opened PR #311 with the fix.', 'pr.opened', { number: '311' }),
          said(m2!, 'Merged it.', 'pr.opened'),
          said('someone-else', 'Ship the fix', 'unchecked'),
        ],
      }),
    );
    const first = await claimsOf('s1');
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({
      runId: 's1',
      model: 'claude-opus-5-5-test',
      cached: false,
      messages: 2,
      dropped: { 'quote-not-found': 1, 'unknown-message': 1 },
    });
    const claims = first.json<{ claims: { modality: string; appended: boolean }[] }>().claims;
    expect(claims.map((c) => [c.modality, c.appended])).toEqual([
      ['asserted', true],
      ['hedged', true],
      ['asserted', true],
    ]);
    const [call] = calls;
    expect(call!.body.output_config).toMatchObject({ effort: 'medium' });
    expect(call!.body.fallbacks).toBe('default');
    expect(call!.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(call!.body.messages[0]!.content).toContain(`<message id="${m1!}">`);
    expect(call!.body.messages[0]!.content).not.toContain('Ship the fix');
    const rows = await stored('s1');
    expect(rows.map((row) => [row.provenance, row.attrs['claim.text']])).toEqual([
      ['derived', 'All 142 tests pass.'],
      ['derived', 'I think staging is fine.'],
      ['derived', 'Opened PR #311 with the fix.'],
    ]);
    expect(rows[0]!.attrs).toMatchObject({
      'claim.span.start': 0,
      'claim.span.end': 19,
      'claim.param.passed': 142,
    });

    const again = await claimsOf('s1');
    expect(again.json()).toMatchObject({ cached: true });
    expect(again.json<{ claims: { appended: boolean }[] }>().claims.every((c) => !c.appended)).toBe(
      true,
    );
    expect(calls).toHaveLength(1);
    expect(await stored('s1')).toHaveLength(3);
  });

  it('re-extracts a grown transcript and appends only claims that overlap none stored', async () => {
    const [m3] = await ingest(message('s1', 4, 'agent', 'Preview deploy is live.'));
    const ids = (
      await admin<{ id: string }[]>`
      SELECT id FROM events WHERE run_id = 's1' AND kind = 'agent.message' AND actor->>'type' = 'agent' ORDER BY seq`
    ).map((r) => r.id);
    answers.push(
      JSON.stringify({
        claims: [
          said(ids[0]!, 'All 142 tests pass.', 'tests.passed'),
          said(m3!, 'Preview deploy is live.', 'deploy.ready', { target: 'preview' }),
        ],
      }),
    );
    const grown = await claimsOf('s1');
    expect(grown.json()).toMatchObject({ cached: false, messages: 3 });
    expect(grown.json<{ claims: { appended: boolean }[] }>().claims.map((c) => c.appended)).toEqual(
      [false, true],
    );
    expect(await stored('s1')).toHaveLength(4);
  });

  it('answers 404, an empty check without agent words, 413 over the cap and 502 on an unreadable reply', async () => {
    expect((await claimsOf('nope')).statusCode).toBe(404);
    await ingest(message('s2', 1, 'human', 'Hello?'));
    const before = calls.length;
    expect((await claimsOf('s2')).json()).toMatchObject({ messages: 0, model: null, claims: [] });
    await ingest(
      message('s3', 1, 'agent', 'x'.repeat(4000)),
      message('s3', 2, 'agent', 'z'.repeat(4000)),
    );
    expect((await claimsOf('s3')).statusCode).toBe(413);
    expect(calls).toHaveLength(before);
    await ingest(message('s4', 1, 'agent', 'Rotated the key.'));
    answers.push('not json');
    expect((await claimsOf('s4')).statusCode).toBe(502);
    answers.push('{"claims": "nope"}');
    expect((await claimsOf('s4')).statusCode).toBe(502);
    answers.push('refuse-400');
    const refused = await claimsOf('s4');
    expect(refused.statusCode).toBe(502);
    expect(refused.json<{ message: string }>().message).toBe(
      'claim extraction failed: the model API answered 400',
    );
    expect(calls).toHaveLength(before + 3);
  });

  it('shares one model call between concurrent requests and never appends a claim twice', async () => {
    const [m] = await ingest(message('s5', 1, 'agent', 'Deployed to production.'));
    answers.push(JSON.stringify({ claims: [said(m!, 'Deployed to production.', 'deploy.ready')] }));
    const before = calls.length;
    const both = await Promise.all([claimsOf('s5'), claimsOf('s5')]);
    expect(both.map((res) => res.statusCode)).toEqual([200, 200]);
    expect(calls).toHaveLength(before + 1);
    expect(await stored('s5')).toHaveLength(1);
  });

  it('reads only the agent’s own words and drops a claim whose text redaction would change', async () => {
    const [order, , , long] = await ingest(
      message('s6', 1, 'agent', 'Order 4111111111111111 2 shipped.'),
      {
        ...message('s6', 2, 'agent', 'unused'),
        content: { 'gen_ai.input.messages': 'Check order 99 for the subagent' },
      },
      {
        ...message('s6', 3, 'agent', 'unused'),
        kind: 'tool.result',
        content: { 'gen_ai.tool.call.result': 'tool output 77' },
      },
      message('s6', 4, 'agent', `Done. ${'y'.repeat(4200)}`),
    );
    answers.push(
      JSON.stringify({
        claims: [
          said(order!, 'Order 4111111111111111', 'unchecked'),
          said(long!, 'Done.', 'unchecked'),
        ],
      }),
    );
    const res = await claimsOf('s6');
    expect(res.json()).toMatchObject({
      messages: 2,
      truncated: 1,
      dropped: { 'changed-by-redaction': 1 },
    });
    const sent = calls[calls.length - 1]!.body.messages[0]!.content;
    expect(sent).not.toContain('Check order 99');
    expect(sent).not.toContain('tool output 77');
    expect(sent).not.toContain('…[+');
    const rows = await stored('s6');
    expect(rows.map((row) => row.attrs['claim.text'])).toEqual(['Done.']);
  });

  it('answers 503 without a key, unless the reply is already cached', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const bare = await createApp();
    await bare.init();
    try {
      const fresh = await inject(bare, '/v1/runs/s4/claims');
      expect(fresh.statusCode).toBe(503);
      expect(fresh.json<{ message: string }>().message).toContain('ANTHROPIC_API_KEY');
      expect((await inject(bare, '/v1/runs/s1/claims')).json()).toMatchObject({ cached: true });
    } finally {
      await bare.close();
      process.env.ANTHROPIC_API_KEY = 'test-key';
    }
  });
});
