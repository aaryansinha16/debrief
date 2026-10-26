import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { TestReportError } from '@debrief/witness-github';
import { rest, SHA_PUSH } from '@debrief/witness-github/fixtures';
import { describe, expect, it } from 'vitest';

import { createGithubClient } from './github-api.js';

function clientWith(respond: (url: string) => Response, log?: (message: string) => void) {
  const urls: { url: string; method: string | undefined; auth: string | null }[] = [];
  const client = createGithubClient({
    token: 'ghp_x',
    apiUrl: 'https://gh.test',
    ...(log === undefined ? {} : { log }),
    fetch: ((url: string, init: RequestInit) => {
      urls.push({
        url,
        method: init.method,
        auth: new Headers(init.headers).get('authorization'),
      });
      return Promise.resolve(respond(url));
    }) as typeof fetch,
  });
  return { client, urls };
}

describe('github artifacts', () => {
  it('lists the artifacts of a run', async () => {
    const item = {
      id: 1,
      name: 'junit',
      size_in_bytes: 10,
      expired: false,
      created_at: '2026-10-20T10:10:00Z',
    };
    const { client, urls } = clientWith(() => Response.json({ total_count: 1, artifacts: [item] }));
    expect(await client.artifacts('a/b', 7)).toEqual([item]);
    expect(urls[0]?.url).toBe('https://gh.test/repos/a/b/actions/runs/7/artifacts?per_page=100');
  });

  it('refuses a partial artifact list, truncated or with an unreadable item', async () => {
    const good = { id: 1, name: 'junit', size_in_bytes: 10, expired: false };
    const truncated = clientWith(() => Response.json({ total_count: 300, artifacts: [good] }));
    await expect(truncated.client.artifacts('a/b', 7)).rejects.toThrow(TestReportError);
    const dropped = clientWith(() =>
      Response.json({ total_count: 2, artifacts: [good, { x: 1 }] }),
    );
    await expect(dropped.client.artifacts('a/b', 7)).rejects.toThrow(/1 usable of 2/);
  });

  it('refuses a partial check run list only when asked to be strict', async () => {
    const check: unknown = rest.checkRunsBySha[SHA_PUSH]?.check_runs[0];
    const body = () => Response.json({ total_count: 3, check_runs: [check, { x: 1 }] });
    const logged: string[] = [];
    const { client } = clientWith(body, (message) => logged.push(message));
    expect(await client.checkRuns('a/b', SHA_PUSH)).toHaveLength(1);
    await expect(client.checkRuns('a/b', SHA_PUSH, true)).rejects.toThrow(TestReportError);
    expect(logged.length).toBeGreaterThan(0);
    const whole = clientWith(() => Response.json({ total_count: 1, check_runs: [check] }));
    expect(await whole.client.checkRuns('a/b', SHA_PUSH, true)).toHaveLength(1);
  });

  it('never sends the token to the host an artifact redirects to', async () => {
    const seen: (string | undefined)[] = [];
    const blob = createServer((request, response) => {
      seen.push(request.headers.authorization);
      response.end('PK');
    });
    await new Promise<void>((done) => blob.listen(0, '127.0.0.1', done));
    const api = createServer((_request, response) => {
      const { port } = blob.address() as AddressInfo;
      response.writeHead(302, { location: `http://localhost:${String(port)}/blob` }).end();
    });
    await new Promise<void>((done) => api.listen(0, '127.0.0.1', done));
    try {
      const { port } = api.address() as AddressInfo;
      const client = createGithubClient({
        token: 'ghp_x',
        apiUrl: `http://127.0.0.1:${String(port)}`,
      });
      expect((await client.artifactZip('a/b', 9, 10)).length).toBe(2);
    } finally {
      api.close();
      blob.close();
    }
    expect(seen).toEqual([undefined]);
  });

  it('lists artifacts when no total is reported', async () => {
    const { client } = clientWith(() => Response.json({ artifacts: [] }));
    expect(await client.artifacts('a/b', 7)).toEqual([]);
  });

  it('reads a zip into memory with the read-only token', async () => {
    const { client, urls } = clientWith(() => new Response(new Uint8Array([1, 2, 3])));
    expect([...(await client.artifactZip('a/b', 9, 10))]).toEqual([1, 2, 3]);
    expect(urls[0]).toEqual({
      url: 'https://gh.test/repos/a/b/actions/artifacts/9/zip',
      method: 'GET',
      auth: 'Bearer ghp_x',
    });
  });

  it('refuses a zip over the limit, declared or streamed', async () => {
    const declared = clientWith(
      () => new Response(new Uint8Array(4), { headers: { 'content-length': '999' } }),
    );
    await expect(declared.client.artifactZip('a/b', 9, 10)).rejects.toThrow(TestReportError);
    const streamed = clientWith(() => new Response(new Uint8Array(11)));
    await expect(streamed.client.artifactZip('a/b', 9, 10)).rejects.toThrow(/over 10 bytes/);
  });

  it('reads an empty body as an empty zip', async () => {
    const { client } = clientWith(() => new Response(null, { status: 200 }));
    expect((await client.artifactZip('a/b', 9, 10)).length).toBe(0);
  });
});
