import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadSigningKey } from './signing-key.js';

const secret = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';

describe('loadSigningKey', () => {
  it('loads from an inline secret and derives the public entry', () => {
    const key = loadSigningKey({ SIGNING_KEY_SECRET: secret });
    expect(key.publicKeys).toEqual([
      {
        keyId: '21fe31dfa154a261',
        alg: 'ed25519',
        publicKey: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
      },
    ]);
    expect(key.keypair.keyId).toBe('21fe31dfa154a261');
  });

  it('loads from a key file and prefers the inline secret when both are set', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'debrief-key-')), 'key.json');
    writeFileSync(
      file,
      JSON.stringify({ keyId: 'x', alg: 'ed25519', publicKey: 'y', secretKey: secret }),
    );
    expect(loadSigningKey({ SIGNING_KEY_FILE: file }).keypair.keyId).toBe('21fe31dfa154a261');
    expect(
      loadSigningKey({ SIGNING_KEY_FILE: file, SIGNING_KEY_SECRET: 'ab'.repeat(32) }).keypair.keyId,
    ).not.toBe('21fe31dfa154a261');
  });

  it('rejects a malformed key file', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'debrief-key-')), 'key.json');
    writeFileSync(file, JSON.stringify({ secretKey: 'nope' }));
    expect(() => loadSigningKey({ SIGNING_KEY_FILE: file })).toThrow();
    expect(() => loadSigningKey({ SIGNING_KEY_FILE: join(file, 'missing') })).toThrow();
  });
});
