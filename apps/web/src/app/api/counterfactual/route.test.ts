import { demoRunFixture } from '@debrief/reconstruct/fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const post = (url: string, body?: BodyInit): Request =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body }),
  });

describe('POST /api/counterfactual', () => {
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

  it('forwards the policy to the run and returns the branch', async () => {
    const [first] = demoRunFixture();
    const branch = {
      runId: 'run-1',
      halted: false,
      prefix: [first],
      timeline: [{ event: first, status: 'happened' }],
      marked: [],
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(branch), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await POST(
      post(
        'http://web.test/api/counterfactual?run=run-1',
        JSON.stringify({ policy: 'version: 1' }),
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(branch);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url instanceof URL ? url.href : '').toBe(
      'http://api.test:4000/v1/runs/run-1/counterfactual',
    );
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ policy: 'version: 1' }));
    expect(init?.headers).toMatchObject({ authorization: 'Bearer dbk_test' });
  });

  it('rejects a missing run, a non-json body and a body without a policy', async () => {
    expect((await POST(post('http://web.test/api/counterfactual', '{}'))).status).toBe(400);
    expect((await POST(post('http://web.test/api/counterfactual?run=', '{}'))).status).toBe(400);
    expect((await POST(post('http://web.test/api/counterfactual?run=r', 'nope'))).status).toBe(400);
    expect(
      (await POST(post('http://web.test/api/counterfactual?run=r', '{"policy":""}'))).status,
    ).toBe(400);
    expect(
      (await POST(post('http://web.test/api/counterfactual?run=r', '{"other":1}'))).status,
    ).toBe(400);
  });

  it('maps upstream failures and a missing key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 404 })),
    );
    const missing = await POST(
      post('http://web.test/api/counterfactual?run=r', JSON.stringify({ policy: 'version: 1' })),
    );
    expect(missing.status).toBe(404);
    delete process.env.DEBRIEF_API_KEY;
    const unconfigured = await POST(
      post('http://web.test/api/counterfactual?run=r', JSON.stringify({ policy: 'version: 1' })),
    );
    expect(unconfigured.status).toBe(503);
    process.env.DEBRIEF_API_KEY = 'dbk_test';
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('down')));
    await expect(
      POST(
        post('http://web.test/api/counterfactual?run=r', JSON.stringify({ policy: 'version: 1' })),
      ),
    ).rejects.toThrow('down');
  });
});
