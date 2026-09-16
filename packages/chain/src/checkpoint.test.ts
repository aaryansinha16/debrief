import type { Checkpoint } from '@debrief/schema';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';

import { canonicalize } from './canonicalize.js';
import {
  type PublicKeyEntry,
  type UnsignedCheckpoint,
  checkpointSigningBytes,
  deriveKeyId,
  generateKeypair,
  publicKeyEntry,
  signBytes,
  signCheckpoint,
  signingKeyRecord,
  verifyBytes,
  verifyCheckpoint,
} from './checkpoint.js';

const rfc8032 = [
  {
    secret: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
    publicKey: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    message: '',
    signature:
      'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
  },
  {
    secret: '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
    publicKey: '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
    message: '72',
    signature:
      '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00',
  },
];

const seed = hexToBytes(rfc8032[0]!.secret);
const signer = generateKeypair(seed);
const trusted: PublicKeyEntry[] = [publicKeyEntry(signer.publicKey)];

const unsigned: UnsignedCheckpoint = {
  tenantId: 'tenant-demo',
  treeSize: 10,
  rootHash: 'ab'.repeat(32),
  headHash: 'cd'.repeat(32),
  ts: '2026-09-17T00:00:10.000Z',
};

describe('ed25519 primitives', () => {
  it.each(rfc8032)(
    'matches RFC 8032 vector with message %j',
    ({ secret, publicKey, message, signature }) => {
      const keypair = generateKeypair(hexToBytes(secret));
      expect(bytesToHex(keypair.publicKey)).toBe(publicKey);
      const signed = signBytes(hexToBytes(message), keypair.secretKey);
      expect(bytesToHex(signed)).toBe(signature);
      expect(verifyBytes(signed, hexToBytes(message), keypair.publicKey)).toBe(true);
    },
  );

  it('rejects malformed signatures without throwing', () => {
    expect(verifyBytes(new Uint8Array(3), utf8ToBytes('x'), signer.publicKey)).toBe(false);
    expect(verifyBytes(new Uint8Array(64), utf8ToBytes('x'), signer.publicKey)).toBe(false);
  });
});

describe('keys', () => {
  it('derives a 16-hex key id from the public key', () => {
    expect(signer.keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(deriveKeyId(signer.publicKey)).toBe(signer.keyId);
    expect(generateKeypair().keyId).not.toBe(signer.keyId);
  });

  it('generates distinct random keypairs and deterministic seeded ones', () => {
    const a = generateKeypair();
    const b = generateKeypair();
    expect(bytesToHex(a.secretKey)).not.toBe(bytesToHex(b.secretKey));
    expect(bytesToHex(generateKeypair(seed).secretKey)).toBe(bytesToHex(seed));
  });

  it('keeps the secret out of the public entry', () => {
    const entry = publicKeyEntry(signer.publicKey);
    expect(Object.keys(entry).sort()).toEqual(['alg', 'keyId', 'publicKey']);
    expect(JSON.stringify(entry)).not.toContain(bytesToHex(signer.secretKey));
    const record = signingKeyRecord(signer);
    expect(record).toEqual({ ...entry, secretKey: rfc8032[0]!.secret });
  });
});

describe('signCheckpoint', () => {
  it('sets the key id and signs the canonical checkpoint minus signature', () => {
    const checkpoint = signCheckpoint(unsigned, signer.secretKey);
    expect(checkpoint.keyId).toBe(signer.keyId);
    expect(checkpoint.signature).toMatch(/^[0-9a-f]{128}$/);
    const { signature, ...body } = checkpoint;
    expect(checkpointSigningBytes(body)).toEqual(utf8ToBytes(canonicalize(body)));
    expect(checkpointSigningBytes(checkpoint)).toEqual(checkpointSigningBytes(body));
    expect(verifyBytes(hexToBytes(signature), checkpointSigningBytes(body), signer.publicKey)).toBe(
      true,
    );
  });

  it('is deterministic and covers the optional anchor', () => {
    expect(signCheckpoint(unsigned, signer.secretKey)).toEqual(
      signCheckpoint(unsigned, signer.secretKey),
    );
    const anchored = signCheckpoint(
      { ...unsigned, anchor: { kind: 'rfc3161', ref: 'tsa:1' } },
      signer.secretKey,
    );
    expect(anchored.signature).not.toBe(signCheckpoint(unsigned, signer.secretKey).signature);
    expect(verifyCheckpoint(anchored, trusted)).toEqual({ ok: true, keyId: signer.keyId });
  });
});

describe('verifyCheckpoint', () => {
  const checkpoint = signCheckpoint(unsigned, signer.secretKey);
  const other = generateKeypair();

  it('accepts a genuine checkpoint from a trusted key', () => {
    expect(verifyCheckpoint(checkpoint, trusted)).toEqual({ ok: true, keyId: signer.keyId });
    expect(verifyCheckpoint(checkpoint, [publicKeyEntry(other.publicKey), ...trusted]).ok).toBe(
      true,
    );
  });

  it.each([
    ['rootHash', { rootHash: 'ef'.repeat(32) }],
    ['headHash', { headHash: 'ef'.repeat(32) }],
    ['treeSize', { treeSize: 11 }],
    ['tenantId', { tenantId: 'tenant-other' }],
    ['ts', { ts: '2026-09-17T00:00:11.000Z' }],
    ['anchor', { anchor: { kind: 'rekor', ref: 'log:1' } }],
    ['signature', { signature: `${checkpoint.signature.slice(0, -2)}00` }],
  ])('rejects an altered %s', (_field, patch) => {
    const altered = { ...checkpoint, ...patch } as Checkpoint;
    expect(verifyCheckpoint(altered, trusted)).toEqual({ ok: false, reason: 'signature' });
  });

  it('rejects a wrong key id', () => {
    expect(verifyCheckpoint({ ...checkpoint, keyId: other.keyId }, trusted)).toEqual({
      ok: false,
      reason: 'unknown-key',
    });
    expect(
      verifyCheckpoint({ ...checkpoint, keyId: other.keyId }, [
        ...trusted,
        publicKeyEntry(other.publicKey),
      ]),
    ).toEqual({ ok: false, reason: 'signature' });
    expect(
      verifyCheckpoint(checkpoint, [
        { keyId: signer.keyId, alg: 'ed25519', publicKey: bytesToHex(other.publicKey) },
      ]),
    ).toEqual({ ok: false, reason: 'key-id-mismatch' });
  });

  it('rejects unsupported algorithms and malformed signatures', () => {
    expect(verifyCheckpoint(checkpoint, [{ ...trusted[0]!, alg: 'rsa' }])).toEqual({
      ok: false,
      reason: 'unsupported-alg',
    });
    expect(verifyCheckpoint({ ...checkpoint, signature: 'zz' }, trusted)).toEqual({
      ok: false,
      reason: 'signature',
    });
    expect(verifyCheckpoint({ ...checkpoint, signature: 'ab'.repeat(32) }, trusted)).toEqual({
      ok: false,
      reason: 'signature',
    });
  });
});
