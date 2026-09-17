import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

describe('GET /api/live', () => {
  const originalKey = process.env.DEBRIEF_API_KEY;
  beforeEach(() => {
    process.env.DEBRIEF_API_KEY = 'dbk_test';
    process.env.DEBRIEF_API_URL = 'http://api.test:4000';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.DEBRIEF_API_KEY;
    else process.env.DEBRIEF_API_KEY = originalKey;
  });

  it('streams the upstream body with event-stream headers, forwarding the cursor and Last-Event-ID', async () => {
    const chunks = ['retry: 1000\n\n', 'event: event\nid: 7\ndata: {"seq":7}\n\n'];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(
      new Request('http://web.test/api/live?since=6&run=r1', {
        headers: { 'last-event-id': '6' },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(await response.text()).toBe(chunks.join(''));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url instanceof URL ? url.href : '').toBe('http://api.test:4000/v1/live?since=6&run=r1');
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer dbk_test',
      accept: 'text/event-stream',
      'last-event-id': '6',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('starts at the head without a cursor and ignores a malformed Last-Event-ID', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(
      new Request('http://web.test/api/live', { headers: { 'last-event-id': 'nope' } }),
    );
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url instanceof URL ? url.href : '').toBe('http://api.test:4000/v1/live');
    expect((init?.headers as Record<string, string>)['last-event-id']).toBeUndefined();
  });

  it('rejects a bad cursor or empty run and maps upstream failures', async () => {
    expect((await GET(new Request('http://web.test/api/live?since=abc'))).status).toBe(400);
    expect((await GET(new Request('http://web.test/api/live?run='))).status).toBe(400);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 })),
    );
    expect((await GET(new Request('http://web.test/api/live'))).status).toBe(401);
    delete process.env.DEBRIEF_API_KEY;
    expect((await GET(new Request('http://web.test/api/live'))).status).toBe(503);
    process.env.DEBRIEF_API_KEY = 'dbk_test';
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('down')));
    await expect(GET(new Request('http://web.test/api/live'))).rejects.toThrow('down');
  });
});
