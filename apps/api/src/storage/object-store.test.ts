import { describe, expect, it } from 'vitest';

import { MemoryObjectStore, S3ObjectStore } from './object-store.js';

describe('MemoryObjectStore', () => {
  it('stores copies and returns undefined for unknown keys', async () => {
    const store = new MemoryObjectStore();
    const body = new Uint8Array([1, 2, 3]);
    await store.put('a', body, 'application/octet-stream');
    body[0] = 9;
    expect(await store.get('a')).toEqual({
      body: new Uint8Array([1, 2, 3]),
      contentType: 'application/octet-stream',
    });
    expect(await store.get('b')).toBeUndefined();
    expect(await store.downloadUrl('a', 60)).toBeUndefined();
  });
});

describe.skipIf(process.env.S3_ENDPOINT === undefined)('S3ObjectStore', () => {
  it('round-trips an object through the bucket', async () => {
    const env = process.env as Record<string, string>;
    const store = S3ObjectStore.fromConfig({
      S3_ENDPOINT: env.S3_ENDPOINT!,
      S3_BUCKET: env.S3_BUCKET!,
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID!,
      S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY!,
    });
    const key = `test/${String(Date.now())}.json`;
    await store.put(key, new TextEncoder().encode('{"ok":true}'), 'application/json');
    expect(await store.get(key)).toEqual({
      body: new TextEncoder().encode('{"ok":true}'),
      contentType: 'application/json',
    });
    expect(await store.get(`${key}.missing`)).toBeUndefined();
    const url = await store.downloadUrl(key, 60);
    expect(url).toContain(encodeURIComponent(key).replaceAll('%2F', '/'));
    expect(url).toContain('X-Amz-Signature=');
    const fetched = await fetch(url);
    expect(fetched.status).toBe(200);
    expect(await fetched.text()).toBe('{"ok":true}');
    store.destroy();
  });
});
