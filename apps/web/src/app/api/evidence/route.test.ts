import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as GET_JOB } from './[jobId]/route';
import { GET as GET_BUNDLE } from './[jobId]/bundle/route';
import { POST } from './route';

const job = { id: 'j1', runId: 'r1', status: 'queued', createdAt: '2026-09-18T09:00:00Z' };
const post = (url: string, body?: string): Request =>
  new Request(url, { method: 'POST', ...(body === undefined ? {} : { body }) });
const params = { params: Promise.resolve({ jobId: 'j1' }) };

describe('evidence proxies', () => {
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

  it('queues a job, polls it and streams the bundle', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(job), { status: 200 })),
      );
    vi.stubGlobal('fetch', fetchMock);
    const queued = await POST(
      post('http://web.test/api/evidence?run=r1', JSON.stringify({ includeContent: true })),
    );
    expect(queued.status).toBe(202);
    expect(await queued.json()).toEqual(job);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url instanceof URL ? url.href : '').toBe('http://api.test:4000/v1/runs/r1/evidence');
    expect(init?.body).toBe(JSON.stringify({ includeContent: true }));
    expect((await POST(post('http://web.test/api/evidence?run=r1'))).status).toBe(202);
    expect(fetchMock.mock.calls[1]![1]?.body).toBe('{}');
    const polled = await GET_JOB(new Request('http://web.test/api/evidence/j1'), params);
    expect(polled.status).toBe(200);
    expect(await polled.json()).toEqual(job);
    const zip = new Uint8Array([80, 75, 3, 4]);
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(zip, { status: 200, headers: { 'content-type': 'application/zip' } }),
        ),
    );
    const bundle = await GET_BUNDLE(new Request('http://web.test/api/evidence/j1/bundle'), params);
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get('content-type')).toBe('application/zip');
    expect(bundle.headers.get('content-disposition')).toContain('debrief-evidence-j1.zip');
    expect(new Uint8Array(await bundle.arrayBuffer())).toEqual(zip);
  });

  it('rejects a missing run or a bad body and maps failures', async () => {
    expect((await POST(post('http://web.test/api/evidence', '{}'))).status).toBe(400);
    expect((await POST(post('http://web.test/api/evidence?run=r1', 'nope'))).status).toBe(400);
    expect(
      (await POST(post('http://web.test/api/evidence?run=r1', '{"includeContent":"yes"}'))).status,
    ).toBe(400);
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(() => Promise.resolve(new Response('{}', { status: 404 }))),
    );
    expect((await POST(post('http://web.test/api/evidence?run=nope', '{}'))).status).toBe(404);
    expect((await GET_JOB(new Request('http://web.test/api/evidence/j1'), params)).status).toBe(
      404,
    );
    expect(
      (await GET_BUNDLE(new Request('http://web.test/api/evidence/j1/bundle'), params)).status,
    ).toBe(404);
    delete process.env.DEBRIEF_API_KEY;
    expect((await POST(post('http://web.test/api/evidence?run=r1', '{}'))).status).toBe(503);
    process.env.DEBRIEF_API_KEY = 'dbk_test';
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('down')));
    await expect(POST(post('http://web.test/api/evidence?run=r1', '{}'))).rejects.toThrow('down');
  });
});
