import { describe, expect, it } from 'vitest';

import { EventsEmitter } from './emitter.js';
import type { ProxyEvent } from './recorder.js';

const event = (n: number): ProxyEvent => ({
  sourceId: `s:${String(n)}`,
  sourceTs: '2026-09-17T00:00:00.000Z',
  source: 'mcp-proxy',
  provenance: 'reported',
  runId: 'r',
  kind: 'mcp.request',
  actor: { type: 'agent', id: 'a' },
  attrs: { n },
});

interface Call {
  url: string;
  headers: Record<string, string>;
  body: { events: ProxyEvent[] };
}

function fakeFetch(statuses: number[]): { calls: Call[]; fetch: typeof fetch } {
  const calls: Call[] = [];
  const doFetch: typeof fetch = (input, init) => {
    const status = statuses.shift() ?? 200;
    calls.push({
      url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(init?.body as string) as { events: ProxyEvent[] },
    });
    return Promise.resolve(new Response(status === 200 ? '{"accepted":1}' : 'nope', { status }));
  };
  return { calls, fetch: doFetch };
}

describe('EventsEmitter', () => {
  it('batches by size and by time and posts with the bearer key', async () => {
    const { calls, fetch } = fakeFetch([]);
    const emitter = new EventsEmitter({
      apiUrl: 'http://api.test',
      apiKey: 'dbf_k',
      maxBatch: 2,
      flushMs: 20,
      fetch,
    });
    emitter.push([event(1), event(2), event(3)]);
    await emitter.drain();
    expect(calls.map((call) => call.body.events.map((e) => e.sourceId))).toEqual([
      ['s:1', 's:2'],
      ['s:3'],
    ]);
    expect(calls[0]!.url).toBe('http://api.test/v1/events');
    expect(calls[0]!.headers.authorization).toBe('Bearer dbf_k');
    emitter.push([event(4)]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(calls).toHaveLength(3);
    expect(emitter.stats).toEqual({ sent: 4, failed: 0, batches: 3 });
    emitter.push([]);
    await emitter.drain();
    expect(calls).toHaveLength(3);
  });

  it('retries server errors and 429s, drops on 4xx, and gives up after max retries', async () => {
    const logs: string[] = [];
    const { calls, fetch } = fakeFetch([503, 429, 200, 400, 500, 500, 500]);
    const emitter = new EventsEmitter({
      apiUrl: 'http://api.test',
      apiKey: 'k',
      maxBatch: 1,
      fetch,
      maxRetries: 2,
      log: (m) => logs.push(m),
    });
    emitter.push([event(1)]);
    await emitter.drain();
    expect(calls).toHaveLength(3);
    expect(emitter.stats.sent).toBe(1);
    emitter.push([event(2)]);
    await emitter.drain();
    expect(emitter.stats.failed).toBe(1);
    expect(logs[0]).toContain('400');
    emitter.push([event(3)]);
    await emitter.drain();
    expect(calls).toHaveLength(7);
    expect(emitter.stats.failed).toBe(2);
    expect(logs[1]).toContain('after retries');
  });

  it('survives a throwing fetch', async () => {
    const emitter = new EventsEmitter({
      apiUrl: 'http://api.test',
      apiKey: 'k',
      maxRetries: 0,
      fetch: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    emitter.push([event(1)]);
    await emitter.drain();
    expect(emitter.stats).toEqual({ sent: 0, failed: 1, batches: 0 });
  });
});
