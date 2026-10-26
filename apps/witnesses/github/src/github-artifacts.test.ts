import { TestReportError } from '@debrief/witness-github';
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
  it('lists a run artifacts and logs what it cannot read or see', async () => {
    const logged: string[] = [];
    const { client, urls } = clientWith(
      () =>
        Response.json({
          total_count: 300,
          artifacts: [{ id: 1, name: 'junit', size_in_bytes: 10, expired: false }, { bogus: 1 }],
        }),
      (message) => logged.push(message),
    );
    expect(await client.artifacts('a/b', 7)).toEqual([
      { id: 1, name: 'junit', size_in_bytes: 10, expired: false },
    ]);
    expect(urls[0]?.url).toBe('https://gh.test/repos/a/b/actions/runs/7/artifacts?per_page=100');
    expect(logged).toEqual([
      'run 7: read 2 artifacts of 300',
      'artifacts: skipped 1 items of unexpected shape',
    ]);
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
