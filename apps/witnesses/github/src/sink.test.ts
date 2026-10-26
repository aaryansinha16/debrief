import { isContentAttribute, eventInputSchema } from '@debrief/schema';
import { describe, expect, it, vi } from 'vitest';

import { collectFixturePoll, fixtureClient, replayPoll, replayWebhooks } from './replay.js';
import { createSink, keyTrust, SinkError } from './sink.js';
import { sign, verifySignature } from './signature.js';

interface Posted {
  url: string;
  auth: string | null;
  body: string;
}

function recordingSink(response: () => Response) {
  const posted: Posted[] = [];
  const sink = createSink({
    apiUrl: 'http://api.test/',
    apiKey: 'dbf_secret',
    fetch: ((url: string, init: RequestInit) => {
      posted.push({
        url,
        auth: new Headers(init.headers).get('authorization'),
        body: init.body as string,
      });
      return Promise.resolve(response());
    }) as typeof fetch,
  });
  return { sink, posted };
}

describe('sink', () => {
  it('posts batches of at most 500 with a bearer key', async () => {
    const { sink, posted } = recordingSink(() => Response.json({ accepted: 1, duplicates: 2 }));
    const wire = (await collectFixturePoll()).events;
    const result = await sink.post(Array.from({ length: 501 }, () => wire[0]!));
    expect(result).toEqual({ accepted: 2, duplicates: 4 });
    expect(posted.map((p) => (JSON.parse(p.body) as { events: unknown[] }).events.length)).toEqual([
      500, 1,
    ]);
    expect(posted[0]).toMatchObject({
      url: 'http://api.test/v1/events',
      auth: 'Bearer dbf_secret',
    });
  });

  it('uses the global fetch by default', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ accepted: 3, duplicates: 0 })));
    try {
      const wire = (await collectFixturePoll()).events;
      const sink = createSink({ apiUrl: 'http://api.test', apiKey: 'dbf_secret' });
      expect((await sink.post([wire[0]!])).accepted).toBe(3);
      vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ trust: 'local' })));
      expect(await keyTrust({ apiUrl: 'http://api.test', apiKey: 'dbf_secret' })).toBe('local');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('counts a reply without totals as zero and never puts the key in an error', async () => {
    const empty = recordingSink(() => Response.json({}));
    const wire = (await collectFixturePoll()).events;
    expect(await empty.sink.post([wire[0]!])).toEqual({ accepted: 0, duplicates: 0 });
    const rejecting = recordingSink(() => new Response('no', { status: 401 }));
    await expect(rejecting.sink.post([wire[0]!])).rejects.toThrow(SinkError);
    await expect(rejecting.sink.post([wire[0]!])).rejects.not.toThrow(/dbf_secret/);
  });

  it('posts only what /v1/events accepts', async () => {
    const { sink, posted } = recordingSink(() => Response.json({ accepted: 1, duplicates: 0 }));
    await replayWebhooks(sink, fixtureClient());
    await replayPoll(sink);
    const events = posted.flatMap(
      (p) => (JSON.parse(p.body) as { events: Record<string, unknown>[] }).events,
    );
    expect(events.length).toBeGreaterThan(0);
    for (const p of posted) {
      expect(Buffer.byteLength(p.body)).toBeLessThanOrEqual(1024 * 1024);
      expect(p.body).not.toContain('\\u0000');
    }
    expect(events.length).toBeLessThanOrEqual(1000);
    for (const event of events) {
      const { sourceId, ...input } = event as { sourceId: string; attrs: Record<string, unknown> };
      expect(['mcp-proxy', 'world-hook', 'api']).toContain(event.source);
      expect(sourceId.length).toBeGreaterThan(0);
      expect(sourceId.length).toBeLessThanOrEqual(512);
      expect(Object.keys(input.attrs).some((name) => isContentAttribute(name))).toBe(false);
      const parsed = eventInputSchema.safeParse({
        ...input,
        id: '01JZ0000000000000000000000',
        ts: '2026-10-20T12:00:00.000Z',
        tenantId: 't1',
      });
      expect(parsed.error?.issues).toBeUndefined();
    }
  });
});

describe('keyTrust', () => {
  it('reads the trust the key holds from /v1/me', async () => {
    const { posted } = recordingSink(() => Response.json({}));
    const read = (response: Response) =>
      keyTrust({
        apiUrl: 'http://api.test/',
        apiKey: 'dbf_secret',
        fetch: ((url: string, init: RequestInit) => {
          posted.push({
            url,
            auth: new Headers(init.headers).get('authorization'),
            body: '',
          });
          return Promise.resolve(response);
        }) as typeof fetch,
      });
    expect(await read(Response.json({ keyId: 'k', trust: 'third-party' }))).toBe('third-party');
    expect(posted[0]).toMatchObject({ url: 'http://api.test/v1/me', auth: 'Bearer dbf_secret' });
    expect(await read(Response.json({ keyId: 'k' }))).toBeUndefined();
    const refused = read(new Response('', { status: 401 }));
    await expect(refused).rejects.toThrow('GET /v1/me failed with 401');
    await expect(refused).rejects.not.toThrow(/dbf_secret/);
  });
});

describe('replay', () => {
  it('fails loudly when a delivery cannot be recorded', async () => {
    const failing = { post: () => Promise.reject(new SinkError(500)) };
    await expect(replayWebhooks(failing)).rejects.toThrow(/d-0001: 502/);
  });

  it('serves empty lists for what the fixtures do not hold', async () => {
    const client = fixtureClient();
    expect(await client.jobs('a/b', 1, 1)).toEqual([]);
    expect(await client.checkRuns('a/b', 'unknown')).toEqual([]);
  });
});

describe('signature', () => {
  const body = Buffer.from('{"a":1}');
  it('accepts the right HMAC and rejects everything else', () => {
    const good = sign('s3cret', body);
    expect(verifySignature('s3cret', body, good)).toBe(true);
    expect(verifySignature('other', body, good)).toBe(false);
    expect(verifySignature('s3cret', Buffer.from('{"a":2}'), good)).toBe(false);
    expect(verifySignature('s3cret', body, undefined)).toBe(false);
    expect(verifySignature('s3cret', body, 'sha256=abcd')).toBe(false);
    expect(verifySignature('s3cret', body, good.replace('sha256=', 'sha1='))).toBe(false);
  });
});
