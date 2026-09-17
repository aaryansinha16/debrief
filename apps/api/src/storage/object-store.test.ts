import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config/config.js';
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
  });
});

describe.skipIf(process.env.S3_ENDPOINT === undefined)('S3ObjectStore', () => {
  it('round-trips an object through the bucket', async () => {
    const store = S3ObjectStore.fromConfig(loadConfig());
    const key = `test/${String(Date.now())}.json`;
    await store.put(key, new TextEncoder().encode('{"ok":true}'), 'application/json');
    expect(await store.get(key)).toEqual({
      body: new TextEncoder().encode('{"ok":true}'),
      contentType: 'application/json',
    });
    expect(await store.get(`${key}.missing`)).toBeUndefined();
    store.destroy();
  });
});
