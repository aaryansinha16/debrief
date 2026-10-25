import type { AddressInfo } from 'node:net';

import type { GithubWireEvent } from '@debrief/witness-github';
import { deliveries, FIXTURE_REPO } from '@debrief/witness-github/fixtures';
import { describe, expect, it } from 'vitest';

import { createGithubClient, GithubApiError } from './github-api.js';
import { collectRepo, newPollState, pollOnce } from './poller.js';
import { handleDelivery, createReceiverServer } from './receiver.js';
import { collectFixturePoll, fixtureClient, replayPoll, replayWebhooks } from './replay.js';
import { createSink, type Sink, SinkError } from './sink.js';
import { sign, verifySignature } from './signature.js';

const SECRET = 's3cret';

function memorySink(): Sink & { stored: Map<string, GithubWireEvent>; calls: number } {
  const stored = new Map<string, GithubWireEvent>();
  return {
    stored,
    calls: 0,
    post(events) {
      this.calls += 1;
      let duplicates = 0;
      for (const event of events) {
        if (stored.has(event.sourceId)) duplicates += 1;
        else stored.set(event.sourceId, event);
      }
      return Promise.resolve({ accepted: events.length - duplicates, duplicates });
    },
  };
}

const bySourceId = (events: Iterable<GithubWireEvent>): GithubWireEvent[] =>
  [...events].sort((a, b) => a.sourceId.localeCompare(b.sourceId));

const delivery = (index: number) => {
  const found = deliveries[index];
  if (found === undefined) throw new Error('fixture');
  const body = Buffer.from(JSON.stringify(found.payload));
  return { event: found.event, body, signature: sign(SECRET, body) };
};

describe('signature', () => {
  const body = Buffer.from('{"a":1}');
  it('accepts the right HMAC and rejects everything else', () => {
    expect(verifySignature(SECRET, body, sign(SECRET, body))).toBe(true);
    expect(verifySignature('other', body, sign(SECRET, body))).toBe(false);
    expect(verifySignature(SECRET, Buffer.from('{"a":2}'), sign(SECRET, body))).toBe(false);
    expect(verifySignature(SECRET, body, undefined)).toBe(false);
    expect(verifySignature(SECRET, body, 'sha256=abcd')).toBe(false);
    expect(verifySignature(SECRET, body, sign(SECRET, body).replace('sha256=', 'sha1='))).toBe(
      false,
    );
  });
});

describe('poller and webhooks', () => {
  it('produce the same events for the same fixture', async () => {
    const hooks = memorySink();
    await replayWebhooks(hooks, fixtureClient());
    const polled = memorySink();
    await replayPoll(polled);
    expect(bySourceId(hooks.stored.values())).toEqual(bySourceId(polled.stored.values()));
    expect(hooks.stored.size).toBe(7);
  });

  it('stores a redelivered event once', async () => {
    const sink = memorySink();
    const first = await replayWebhooks(sink, fixtureClient());
    const second = await replayWebhooks(sink, fixtureClient());
    const polled = await replayPoll(sink);
    expect(first).toEqual({ accepted: 7, duplicates: 0 });
    expect(second.accepted).toBe(0);
    expect(polled.accepted).toBe(0);
    expect(sink.stored.size).toBe(7);
  });

  it('does not refetch runs it already posted', async () => {
    let jobCalls = 0;
    const client = {
      ...fixtureClient(),
      jobs: (...args: Parameters<ReturnType<typeof fixtureClient>['jobs']>) => {
        jobCalls += 1;
        return fixtureClient().jobs(...args);
      },
    };
    const sink = memorySink();
    const state = newPollState();
    await pollOnce(client, sink, [FIXTURE_REPO], state);
    const callsAfterFirst = jobCalls;
    const again = await pollOnce(client, sink, [FIXTURE_REPO], state);
    expect(jobCalls).toBe(callsAfterFirst);
    expect(again.duplicates).toBe(3);
  });

  it('holds a run back when its jobs cannot be read', async () => {
    const client = {
      ...fixtureClient(),
      jobs: () => Promise.reject(new GithubApiError(403, '/jobs')),
    };
    const collected = await collectRepo(client, FIXTURE_REPO, newPollState());
    expect(collected.events.some((e) => e.target.operation === 'workflow_run.completed')).toBe(
      false,
    );
    expect(collected.errors.join()).toContain('jobs 7002');
    const failing = await collectFixturePoll();
    expect(failing.errors).toEqual([]);
  });

  it('reports a failed post and tries again next pass', async () => {
    const sink: Sink = { post: () => Promise.reject(new SinkError(503)) };
    const state = newPollState();
    const outcome = await pollOnce(fixtureClient(), sink, [FIXTURE_REPO], state);
    expect(outcome.errors.join()).toContain('post');
    expect(state.runs.size).toBe(0);
  });

  it('keeps going when one resource fails', async () => {
    const client = {
      ...fixtureClient(),
      repoEvents: () => Promise.reject(new GithubApiError(500, '/events')),
      checkRuns: () => Promise.reject(new GithubApiError(404, '/check-runs')),
    };
    const outcome = await pollOnce(client, memorySink(), [FIXTURE_REPO], newPollState());
    expect(outcome.errors).toHaveLength(3);
    expect(outcome.events).toBeGreaterThan(0);
  });
});

describe('receiver', () => {
  it('rejects a bad signature before reading the payload', async () => {
    const sink = memorySink();
    const d = delivery(0);
    const result = await handleDelivery({ secret: SECRET, sink }, { ...d, signature: 'sha256=00' });
    expect(result.status).toBe(401);
    expect(sink.calls).toBe(0);
  });

  it('answers ping, ignores other events and actions, and refuses bad JSON', async () => {
    const sink = memorySink();
    const ping = Buffer.from('{}');
    const options = { secret: SECRET, sink };
    const signed = (event: string, body: Buffer) => ({
      event,
      body,
      signature: sign(SECRET, body),
    });
    expect((await handleDelivery(options, signed('ping', ping))).status).toBe(200);
    expect((await handleDelivery(options, signed('star', ping))).status).toBe(202);
    expect((await handleDelivery(options, signed('push', Buffer.from('nope')))).status).toBe(400);
    expect((await handleDelivery(options, signed('push', Buffer.from('{"ref":1}')))).status).toBe(
      400,
    );
    expect((await handleDelivery(options, delivery(3))).status).toBe(202);
    expect(sink.calls).toBe(0);
  });

  it('records without counts when no token is configured', async () => {
    const sink = memorySink();
    const result = await handleDelivery({ secret: SECRET, sink }, delivery(6));
    expect(result.status).toBe(200);
    const [event] = sink.stored.values();
    expect(Object.keys(event?.attrs ?? {}).some((k) => k.startsWith('ci.jobs'))).toBe(false);
  });

  it('answers 502 when the sink or the jobs lookup fails, so the delivery can be redelivered', async () => {
    const failing: Sink = { post: () => Promise.reject(new SinkError(500)) };
    expect((await handleDelivery({ secret: SECRET, sink: failing }, delivery(0))).status).toBe(502);
    const github = {
      ...fixtureClient(),
      jobs: () => Promise.reject(new GithubApiError(500, '/jobs')),
    };
    const sink = memorySink();
    const result = await handleDelivery(
      { secret: SECRET, sink, github, log: () => undefined },
      delivery(6),
    );
    expect(result.status).toBe(502);
    expect(sink.calls).toBe(0);
  });

  it('serves over http', async () => {
    const sink = memorySink();
    const server = createReceiverServer({ secret: SECRET, sink });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const d = delivery(0);
    const post = (path: string, headers: Record<string, string>, body: Buffer | string = d.body) =>
      fetch(`http://127.0.0.1:${String(port)}${path}`, { method: 'POST', headers, body });
    try {
      const ok = await post('/webhook', {
        'x-github-event': d.event,
        'x-hub-signature-256': d.signature,
      });
      expect(ok.status).toBe(200);
      expect((await post('/other', {})).status).toBe(404);
      const unsigned = await post('/webhook', { 'x-github-event': d.event });
      expect(unsigned.status).toBe(401);
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
});

describe('clients', () => {
  it('posts batches with a bearer key and never puts it in an error', async () => {
    const seen: { url: string; auth: string | null; count: number }[] = [];
    const sink = createSink({
      apiUrl: 'http://api.test/',
      apiKey: 'dbf_secret',
      fetch: (async (url: string, init: RequestInit) => {
        await Promise.resolve();
        const events = (JSON.parse(init.body as string) as { events: unknown[] }).events;
        seen.push({
          url,
          auth: new Headers(init.headers).get('authorization'),
          count: events.length,
        });
        return Response.json({ accepted: events.length, duplicates: 0 });
      }) as typeof fetch,
    });
    const event = (await collectFixturePoll()).events[0]!;
    const result = await sink.post(Array.from({ length: 501 }, () => event));
    expect(result.accepted).toBe(501);
    expect(seen.map((s) => s.count)).toEqual([500, 1]);
    expect(seen[0]).toMatchObject({ url: 'http://api.test/v1/events', auth: 'Bearer dbf_secret' });
    const rejecting = createSink({
      apiUrl: 'http://api.test',
      apiKey: 'dbf_secret',
      fetch: () => Promise.resolve(new Response('no', { status: 401 })),
    });
    await expect(rejecting.post([event])).rejects.toThrow(/401$/);
    await expect(rejecting.post([event])).rejects.not.toThrow(/dbf_secret/);
  });

  it('reads GitHub with GET only and a version header', async () => {
    const calls: { url: string; method?: string; accept: string | null }[] = [];
    const client = createGithubClient({
      token: 'ghp_x',
      apiUrl: 'https://gh.test/',
      fetch: (async (url: string, init: RequestInit) => {
        await Promise.resolve();
        calls.push({
          url,
          ...(init.method ? { method: init.method } : {}),
          accept: new Headers(init.headers).get('accept'),
        });
        if (url.includes('/jobs'))
          return Response.json({ jobs: [{ id: 1, status: 'completed', conclusion: 'success' }] });
        if (url.includes('/actions/runs'))
          return Response.json({ workflow_runs: [{ bogus: true }] });
        if (url.includes('/check-runs')) return Response.json({ check_runs: [] });
        if (url.includes('/pulls/')) return Response.json({ number: 1 });
        if (url.includes('/pulls')) return Response.json([]);
        if (url.includes('/events')) return Response.json([{ type: 'WatchEvent' }]);
        return new Response('x', { status: 404 });
      }) as typeof fetch,
    });
    expect(await client.repoEvents('a/b')).toEqual([]);
    expect(await client.pulls('a/b')).toEqual([]);
    expect(await client.completedRuns('a/b')).toEqual([]);
    expect(await client.checkRuns('a/b', 'abc')).toEqual([]);
    expect(await client.jobs('a/b', 5)).toHaveLength(1);
    await expect(client.pull('a/b', 1)).rejects.toThrow();
    expect(
      calls.every((c) => c.method === 'GET' && c.accept === 'application/vnd.github+json'),
    ).toBe(true);
    const missing = createGithubClient({
      token: 'ghp_x',
      fetch: () => Promise.resolve(new Response('x', { status: 404 })),
    });
    await expect(missing.jobs('a/b', 1)).rejects.toThrow(GithubApiError);
    await expect(missing.jobs('a/b', 1)).rejects.not.toThrow(/ghp_x/);
  });
});
