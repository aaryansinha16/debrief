import { describe, expect, it, vi } from 'vitest';

import { ApiError, issueLocalKey, postEvents, whoAmI } from './api.js';

const KEY = `dbf_${'k'.repeat(43)}`;

function recorder(reply: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(reply());
  }) as typeof globalThis.fetch;
  return { calls, options: { apiUrl: 'http://api.test/', key: KEY, fetch } };
}

describe('api', () => {
  it('posts events with the bearer key and reads the totals', async () => {
    const { calls, options } = recorder(() => Response.json({ accepted: 2, duplicates: 1 }));
    expect(await postEvents(options, [])).toEqual({ accepted: 2, duplicates: 1 });
    expect(calls[0]!.url).toBe('http://api.test/v1/events');
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe(`Bearer ${KEY}`);
    expect(calls[0]!.init.body).toBe('{"events":[]}');
  });

  it('reads the key’s trust and issues a local key', async () => {
    const me = recorder(() => Response.json({ keyId: 'k1', tenantId: 't1', trust: 'third-party' }));
    expect(await whoAmI(me.options)).toMatchObject({ trust: 'third-party' });
    expect(me.calls[0]!.init.method).toBe('GET');
    expect(me.calls[0]!.init.body).toBeUndefined();
    const issue = recorder(() => Response.json({ id: 'k2', key: KEY, trust: 'local' }));
    expect(await issueLocalKey(issue.options, 'claude-code@host')).toMatchObject({ id: 'k2' });
    expect(JSON.parse(issue.calls[0]!.init.body as string)).toEqual({
      name: 'claude-code@host',
      trust: 'local',
    });
  });

  it('throws an ApiError that never carries the key, and passes the abort signal', async () => {
    const { calls, options } = recorder(() => new Response('no', { status: 401 }));
    const signal = AbortSignal.timeout(1000);
    const failing = whoAmI({ ...options, signal });
    await expect(failing).rejects.toThrow(ApiError);
    await expect(failing).rejects.toThrow('GET /v1/me answered 401');
    await expect(failing).rejects.not.toThrow(KEY);
    expect(calls[0]!.init.signal).toBe(signal);
  });

  it('uses the global fetch by default', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ accepted: 0, duplicates: 0 })));
    try {
      expect(await postEvents({ apiUrl: 'http://api.test', key: KEY }, [])).toEqual({
        accepted: 0,
        duplicates: 0,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
