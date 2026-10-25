import { rest } from '@debrief/witness-github/fixtures';
import { describe, expect, it, vi } from 'vitest';

import {
  createGithubClient,
  GithubApiError,
  GithubRateLimitError,
  IncompleteJobsError,
} from './github-api.js';

type Route = (url: string) => Response | undefined;

function clientWith(route: Route, extra: { now?: () => number; log?: (m: string) => void } = {}) {
  const calls: { url: string; method: string | undefined; headers: Headers }[] = [];
  const client = createGithubClient({
    token: 'ghp_x',
    apiUrl: 'https://gh.test/',
    ...extra,
    fetch: ((url: string, init: RequestInit) => {
      calls.push({ url, method: init.method, headers: new Headers(init.headers) });
      return Promise.resolve(route(url) ?? new Response('x', { status: 404 }));
    }) as typeof fetch,
  });
  return { client, calls };
}

const job = (id: number) => ({ id, status: 'completed', conclusion: 'success' });

describe('github client', () => {
  it('only sends GET with a version header and a bearer token', async () => {
    const { client, calls } = clientWith((url) => {
      if (url.includes('/events')) return Response.json([{ type: 'WatchEvent' }, null]);
      if (url.includes('/pulls/')) return Response.json({ number: 1 });
      if (url.includes('/pulls')) return Response.json([]);
      if (url.includes('/actions/runs?')) return Response.json({ workflow_runs: [] });
      if (url.includes('/check-runs')) return Response.json({ check_runs: [] });
      return undefined;
    });
    expect(await client.repoEvents('a/b')).toEqual([]);
    expect(await client.pulls('a/b')).toEqual([]);
    expect(await client.completedRuns('a/b')).toEqual([]);
    expect(await client.checkRuns('a/b', 'abc')).toEqual([]);
    await expect(client.pull('a/b', 1)).rejects.toThrow();
    expect(
      calls.every(
        (c) =>
          c.method === 'GET' &&
          c.headers.get('accept') === 'application/vnd.github+json' &&
          c.headers.get('x-github-api-version') === '2022-11-28' &&
          c.headers.get('authorization') === 'Bearer ghp_x',
      ),
    ).toBe(true);
  });

  it('logs the list items it cannot read instead of dropping them silently', async () => {
    const logged: string[] = [];
    const { client } = clientWith(
      (url) => {
        if (url.includes('/events')) {
          return Response.json([{ type: 'PushEvent' }, { type: 'DeleteEvent' }, { type: 'Other' }]);
        }
        if (url.includes('/actions/runs?')) return Response.json({ workflow_runs: [{ bogus: 1 }] });
        if (url.includes('/check-runs')) {
          return Response.json({ total_count: 150, check_runs: [{ bogus: 1 }] });
        }
        return undefined;
      },
      { log: (m) => logged.push(m) },
    );
    await client.repoEvents('a/b');
    await client.completedRuns('a/b');
    await client.checkRuns('a/b', 'abcdef0123');
    expect(logged).toEqual([
      'events: skipped 1 items of unexpected shape',
      'events: skipped 1 items of unexpected shape',
      'runs: skipped 1 items of unexpected shape',
      'check runs for abcdef0: read 1 of 150',
      'check runs: skipped 1 items of unexpected shape',
    ]);
  });

  it('reads the attempt it was asked for, page by page, until every job is in', async () => {
    const { client, calls } = clientWith((url) => {
      const page = new URL(url).searchParams.get('page');
      return Response.json({
        total_count: 3,
        jobs: page === '1' ? [job(1), job(2)] : [job(3)],
      });
    });
    const jobs = await client.jobs('a/b', 7, 2);
    expect(jobs.map((j) => j.id)).toEqual([1, 2, 3]);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/repos/a/b/actions/runs/7/attempts/2/jobs',
      '/repos/a/b/actions/runs/7/attempts/2/jobs',
    ]);
  });

  it('refuses to return a truncated job list', async () => {
    const empty = clientWith((url) =>
      Response.json({
        total_count: 5,
        jobs: new URL(url).searchParams.get('page') === '1' ? [job(1)] : [],
      }),
    );
    await expect(empty.client.jobs('a/b', 7, 1)).rejects.toThrow(IncompleteJobsError);
    const endless = clientWith(() => Response.json({ total_count: 1000, jobs: [job(1)] }));
    await expect(endless.client.jobs('a/b', 7, 1)).rejects.toThrow('run 7: read 20 of 1000 jobs');
    expect(endless.calls).toHaveLength(20);
  });

  it('stops on Retry-After and does not call again until the wait is over', async () => {
    let clock = 1_000_000;
    let limited = true;
    const { client, calls } = clientWith(
      () =>
        limited
          ? new Response('slow down', { status: 429, headers: { 'retry-after': '30' } })
          : Response.json([]),
      { now: () => clock },
    );
    await expect(client.pulls('a/b')).rejects.toThrow(GithubRateLimitError);
    await expect(client.pulls('a/b')).rejects.toMatchObject({ retryAfterS: 30 });
    expect(calls).toHaveLength(1);
    clock += 30_000;
    limited = false;
    expect(await client.pulls('a/b')).toEqual([]);
  });

  it('waits for X-RateLimit-Reset when the budget is spent', async () => {
    const clock = 1_000_000_000;
    const reset = String(clock / 1000 + 90);
    let step = 0;
    const { client } = clientWith(
      () => {
        step += 1;
        if (step === 1) {
          return Response.json([], {
            headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset },
          });
        }
        return new Response('x', {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0' },
        });
      },
      { now: () => clock },
    );
    expect(await client.pulls('a/b')).toEqual([]);
    await expect(client.pulls('a/b')).rejects.toMatchObject({ retryAfterS: 90 });
  });

  it('falls back to a minute when the limit has no reset time', async () => {
    const { client } = clientWith(
      () =>
        new Response('x', {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0' },
        }),
    );
    await expect(client.pulls('a/b')).rejects.toMatchObject({ retryAfterS: 60 });
    const secondary = clientWith(() => new Response('x', { status: 429 }));
    await expect(secondary.client.pulls('a/b')).rejects.toMatchObject({ retryAfterS: 60 });
  });

  it('backs off, doubling, on a secondary rate limit that names no wait', async () => {
    let clock = 1_000_000;
    let mode: 'limited' | 'ok' = 'limited';
    const { client, calls } = clientWith(
      () =>
        mode === 'limited'
          ? new Response('You have exceeded a secondary rate limit.', {
              status: 403,
              headers: { 'x-ratelimit-remaining': '4000' },
            })
          : Response.json([]),
      { now: () => clock },
    );
    await expect(client.pulls('a/b')).rejects.toMatchObject({ retryAfterS: 60 });
    await expect(client.pulls('a/b')).rejects.toMatchObject({ retryAfterS: 60 });
    expect(calls).toHaveLength(1);
    clock += 60_000;
    await expect(client.pulls('a/b')).rejects.toMatchObject({ retryAfterS: 120 });
    clock += 120_000;
    mode = 'ok';
    expect(await client.pulls('a/b')).toEqual([]);
    mode = 'limited';
    await expect(client.pulls('a/b')).rejects.toMatchObject({ retryAfterS: 60 });
  });

  it('caps the secondary backoff at fifteen minutes', async () => {
    let clock = 1_000_000;
    const { client } = clientWith(() => new Response('secondary rate limit', { status: 403 }), {
      now: () => clock,
    });
    let last = 0;
    for (let i = 0; i < 7; i += 1) {
      const error = (await client.pulls('a/b').catch((e: unknown) => e)) as GithubRateLimitError;
      last = error.retryAfterS;
      clock += last * 1000;
    }
    expect(last).toBe(900);
  });

  it('keeps a plain 403 or 404 as an ordinary error without the token in it', async () => {
    const { client } = clientWith(() => new Response('x', { status: 403 }));
    await expect(client.jobs('a/b', 1, 1)).rejects.toThrow(GithubApiError);
    await expect(client.jobs('a/b', 1, 1)).rejects.not.toThrow(/ghp_x/);
    const missing = clientWith(() => undefined);
    await expect(missing.client.pull('a/b', 1)).rejects.toThrow(/failed with 404/);
  });

  it('lists the runs and events it can read', async () => {
    const { client } = clientWith((url) => {
      if (url.includes('/events')) return Response.json([rest.events[1]]);
      return Response.json({ workflow_runs: [rest.runs[1]] });
    });
    expect(await client.completedRuns('a/b')).toHaveLength(1);
    expect(await client.repoEvents('a/b')).toHaveLength(1);
  });

  it('defaults to api.github.com and the global fetch', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      urls.push(url);
      return Promise.resolve(Response.json([]));
    });
    try {
      await createGithubClient({ token: 'ghp_x' }).pulls('a/b');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(urls[0]).toMatch(/^https:\/\/api\.github\.com\/repos\/a\/b\/pulls/);
  });
});
