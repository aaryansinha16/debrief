import { describe, expect, it } from 'vitest';

import { API_KEY_PREFIX, generateApiKey, hashApiKey, parseBearer } from './api-keys.js';

describe('api keys', () => {
  it('generates prefixed, url-safe, distinct keys with a sha256 hash', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).toMatch(/^dbf_[A-Za-z0-9_-]{43}$/);
    expect(a.key).not.toBe(b.key);
    expect(a.prefix).toBe(a.key.slice(0, 12));
    expect(a.keyHash).toBe(hashApiKey(a.key));
    expect(a.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey('dbf_x')).toBe(hashApiKey('dbf_x'));
    expect(hashApiKey('dbf_x')).not.toBe(hashApiKey('dbf_y'));
  });

  it.each([
    ['Bearer dbf_abc', 'dbf_abc'],
    ['bearer dbf_abc', 'dbf_abc'],
    ['  Bearer   dbf_abc  ', 'dbf_abc'],
    ['Bearer abc', undefined],
    ['Basic dbf_abc', undefined],
    ['dbf_abc', undefined],
    ['Bearer', undefined],
    ['Bearer dbf_a b', undefined],
    ['', undefined],
    [undefined, undefined],
  ])('parses bearer header %j', (header, expected) => {
    expect(parseBearer(header)).toBe(expected);
  });

  it('exposes the prefix', () => {
    expect(API_KEY_PREFIX).toBe('dbf_');
  });
});
