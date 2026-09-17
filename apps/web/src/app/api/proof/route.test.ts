import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

describe('GET /api/proof', () => {
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

  it('proxies the proof with the server key and maps errors', async () => {
    const proof = { event: { id: 'e', seq: 1, hash: 'h' }, checkpoint: {}, proof: [] };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(proof), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const ok = await GET(new Request('http://web.test/api/proof?event=e'));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual(proof);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url instanceof URL ? url.href : '').toBe('http://api.test:4000/v1/proof?event=e');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer dbk_test' });
    expect((await GET(new Request('http://web.test/api/proof'))).status).toBe(400);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 404 })),
    );
    expect((await GET(new Request('http://web.test/api/proof?event=nope'))).status).toBe(404);
    delete process.env.DEBRIEF_API_KEY;
    expect((await GET(new Request('http://web.test/api/proof?event=e'))).status).toBe(503);
    process.env.DEBRIEF_API_KEY = 'dbk_test';
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('down')));
    await expect(GET(new Request('http://web.test/api/proof?event=e'))).rejects.toThrow('down');
  });
});
