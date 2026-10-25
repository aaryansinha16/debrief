import type { AddressInfo } from 'node:net';

import { deliveries } from '@debrief/witness-github/fixtures';
import { describe, expect, it } from 'vitest';

import { GithubApiError, type GithubClient } from './github-api.js';
import { createReceiverServer, handleDelivery, MAX_BODY_BYTES, readBody } from './receiver.js';
import { fixtureClient } from './replay.js';
import { SinkError, type Sink } from './sink.js';
import { sign } from './signature.js';
import { memorySink } from './testing.js';

const SECRET = 's3cret';

const delivery = (index: number) => {
  const found = deliveries[index];
  if (found === undefined) throw new Error('fixture');
  const body = Buffer.from(JSON.stringify(found.payload));
  return { event: found.event, body, signature: sign(SECRET, body) };
};

const signed = (event: string | undefined, body: Buffer) => ({
  event,
  body,
  signature: sign(SECRET, body),
});

describe('handleDelivery', () => {
  it('rejects a bad signature before reading the payload', async () => {
    const sink = memorySink();
    const result = await handleDelivery(
      { secret: SECRET, sink },
      { ...delivery(0), signature: 'sha256=00' },
    );
    expect(result.status).toBe(401);
    expect(sink.calls).toBe(0);
  });

  it('answers ping, ignores other events and actions, and refuses bad payloads', async () => {
    const sink = memorySink();
    const options = { secret: SECRET, sink };
    const empty = Buffer.from('{}');
    expect((await handleDelivery(options, signed('ping', empty))).status).toBe(200);
    expect((await handleDelivery(options, signed('star', empty))).status).toBe(202);
    expect((await handleDelivery(options, signed(undefined, empty))).status).toBe(202);
    expect((await handleDelivery(options, signed('push', Buffer.from('nope')))).status).toBe(400);
    expect((await handleDelivery(options, signed('push', Buffer.from('{"ref":1}')))).status).toBe(
      400,
    );
    expect((await handleDelivery(options, delivery(3))).status).toBe(202);
    expect(sink.calls).toBe(0);
  });

  it('answers 400, not 502, for a push whose pushed_at is not a time', async () => {
    const base = deliveries[0]?.payload as { repository: object };
    const body = Buffer.from(
      JSON.stringify({ ...base, repository: { ...base.repository, pushed_at: 'soon' } }),
    );
    const result = await handleDelivery(
      { secret: SECRET, sink: memorySink() },
      signed('push', body),
    );
    expect(result.status).toBe(400);
  });

  it('records a run without counts when no token is configured', async () => {
    const sink = memorySink();
    const logged: string[] = [];
    const result = await handleDelivery(
      { secret: SECRET, sink, log: (m) => logged.push(m) },
      delivery(6),
    );
    expect(result.status).toBe(200);
    const [event] = sink.stored.values();
    expect(Object.keys(event?.attrs ?? {}).some((k) => k.startsWith('ci.jobs'))).toBe(false);
    expect(logged).toEqual(['workflow_run: 1 stored, 0 duplicate']);
  });

  it('reads the jobs of the delivery’s own attempt', async () => {
    const seen: [string, number, number][] = [];
    const github: GithubClient = {
      ...fixtureClient(),
      jobs: (repo, runId, attempt) => {
        seen.push([repo, runId, attempt]);
        return fixtureClient().jobs(repo, runId, attempt);
      },
    };
    const sink = memorySink();
    const options = { secret: SECRET, sink, github, now: () => new Date('2026-10-20T09:16:30Z') };
    expect((await handleDelivery(options, delivery(8))).status).toBe(200);
    expect(seen).toEqual([['acme-demo/widgets', 7002, 2]]);
    expect((await handleDelivery(options, delivery(0))).status).toBe(200);
    expect(seen).toHaveLength(1);
    const requested = delivery(4);
    expect((await handleDelivery(options, requested)).status).toBe(202);
    expect(seen).toHaveLength(1);
  });

  it('answers 502 when the sink or the jobs lookup fails, so it can be redelivered', async () => {
    const failing: Sink = { post: () => Promise.reject(new SinkError(500)) };
    expect((await handleDelivery({ secret: SECRET, sink: failing }, delivery(0))).status).toBe(502);
    const github: GithubClient = {
      ...fixtureClient(),
      jobs: () => Promise.reject(new GithubApiError(500, '/jobs')),
    };
    const sink = memorySink();
    const logged: string[] = [];
    const options = { secret: SECRET, sink, github, log: (m: string) => logged.push(m) };
    expect((await handleDelivery(options, delivery(6))).status).toBe(502);
    expect(sink.calls).toBe(0);
    expect(logged[0]).toContain('workflow_run');
    expect(logged.join()).not.toContain(SECRET);
  });
});

describe('receiver server', () => {
  async function serve() {
    const sink = memorySink();
    const server = createReceiverServer({ secret: SECRET, sink });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    return { sink, server, port };
  }

  it('serves signed deliveries and refuses the rest', async () => {
    const { sink, server, port } = await serve();
    const d = delivery(0);
    const post = (path: string, headers: Record<string, string>, body: Buffer = d.body) =>
      fetch(`http://127.0.0.1:${String(port)}${path}`, {
        method: 'POST',
        headers,
        body: new Uint8Array(body),
      });
    try {
      const ok = await post('/webhook', {
        'x-github-event': d.event,
        'x-hub-signature-256': d.signature,
      });
      expect(ok.status).toBe(200);
      expect((await post('/other', {})).status).toBe(404);
      expect((await post('/webhook', { 'x-github-event': d.event })).status).toBe(401);
      const huge = await post(
        '/webhook',
        { 'x-github-event': 'push' },
        Buffer.alloc(5 * 1024 * 1024 + 1),
      );
      expect(huge.status).toBe(413);
    } finally {
      server.close();
    }
    expect(sink.stored.size).toBe(1);
  });

  it('reads a body, refuses an oversized one and reports a broken one', async () => {
    async function* chunks(...parts: (Buffer | Error)[]): AsyncGenerator<Buffer> {
      for (const part of parts) {
        if (part instanceof Error) throw part;
        await Promise.resolve();
        yield part;
      }
    }
    expect(await readBody(chunks(Buffer.from('ab'), Buffer.from('c')))).toEqual(Buffer.from('abc'));
    expect(await readBody(chunks(Buffer.alloc(MAX_BODY_BYTES + 1)))).toEqual({
      status: 413,
      body: 'payload too large',
    });
    expect(await readBody(chunks(Buffer.from('a'), new Error('aborted')))).toMatchObject({
      status: 400,
    });
  });
});
