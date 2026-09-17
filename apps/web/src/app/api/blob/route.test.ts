import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const SHA = 'ab'.repeat(32);

describe('GET /api/blob', () => {
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

  it('proxies the redacted document, validates the sha and maps 410 and missing keys', async () => {
    const document = { sourceId: 's', content: { 'gen_ai.output.messages': 'ok' } };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(document), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const ok = await GET(new Request(`http://web.test/api/blob?sha=${SHA}`));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toContain('immutable');
    expect(await ok.json()).toEqual(document);
    const [url] = fetchMock.mock.calls[0]!;
    expect(url instanceof URL ? url.href : '').toBe(`http://api.test:4000/v1/blobs/${SHA}`);
    expect((await GET(new Request('http://web.test/api/blob?sha=nope'))).status).toBe(400);
    expect((await GET(new Request('http://web.test/api/blob'))).status).toBe(400);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 410 })),
    );
    const gone = await GET(new Request(`http://web.test/api/blob?sha=${SHA}`));
    expect(gone.status).toBe(410);
    expect(((await gone.json()) as { message: string }).message).toContain('unrecoverable');
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 404 })),
    );
    expect((await GET(new Request(`http://web.test/api/blob?sha=${SHA}`))).status).toBe(404);
    delete process.env.DEBRIEF_API_KEY;
    expect((await GET(new Request(`http://web.test/api/blob?sha=${SHA}`))).status).toBe(503);
    process.env.DEBRIEF_API_KEY = 'dbk_test';
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('down')));
    await expect(GET(new Request(`http://web.test/api/blob?sha=${SHA}`))).rejects.toThrow('down');
  });
});
