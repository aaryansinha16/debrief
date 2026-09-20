import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';

import {
  AnchorError,
  NO_ANCHOR,
  anchorDigest,
  der,
  fromBase64,
  readAnchor,
  readTimestampResponse,
  readTlv,
  rfc3161Anchorer,
  timestampRequest,
} from './anchor.js';
import { generateKeypair, signCheckpoint, verifyCheckpoint } from './checkpoint.js';

const digest = sha256(new TextEncoder().encode('checkpoint'));
const unsigned = {
  tenantId: 'tenant-demo',
  treeSize: 49,
  rootHash: 'ab'.repeat(32),
  headHash: 'cd'.repeat(32),
  ts: '2026-09-20T10:00:00.000Z',
};

// A fake TSA: reads the imprint out of the request, then answers a response whose token repeats it (or not).
const fakeTsa =
  (status = 0, options: { token?: boolean; imprint?: boolean } = {}) =>
  (request: Uint8Array): Promise<Uint8Array> => {
    const hex = bytesToHex(request);
    const at = hex.indexOf('0420');
    expect(at).toBeGreaterThan(0);
    const imprint = hexToBytes(hex.slice(at + 4, at + 4 + 64));
    const statusInfo = der(0x30, der(0x02, Uint8Array.from([status])));
    const token =
      options.token === false
        ? []
        : [der(0x30, der(0x04, options.imprint === false ? new Uint8Array(32) : imprint))];
    return Promise.resolve(der(0x30, statusInfo, ...token));
  };

describe('anchoring interface', () => {
  it('leaves checkpoints untouched by default', async () => {
    expect(NO_ANCHOR.kind).toBe('none');
    await expect(NO_ANCHOR.anchor({ digest, tenantId: 't', treeSize: 1 })).resolves.toBeUndefined();
  });

  it('digests the checkpoint body without its anchor or signature', () => {
    const keypair = generateKeypair(new Uint8Array(32).fill(1));
    const signed = signCheckpoint(unsigned, keypair.secretKey);
    const bare = anchorDigest(signed);
    expect(bare).toEqual(anchorDigest({ ...signed, anchor: { kind: 'rfc3161', ref: 'x' } }));
    expect(bare).toEqual(anchorDigest({ ...unsigned, keyId: keypair.keyId }));
    expect(bare).not.toEqual(anchorDigest({ ...signed, treeSize: 50 }));
  });
});

describe('timestampRequest', () => {
  it('encodes RFC 3161 TimeStampReq with a SHA-256 imprint and certReq', () => {
    const request = timestampRequest(hexToBytes('00'.repeat(32)));
    expect(bytesToHex(request)).toBe(
      '30390201013031300d06096086480165030402010500042000000000000000000000000000000000000000000000000000000000000000000101ff',
    );
    const withNonce = timestampRequest(digest, Uint8Array.from([0x80, 1]));
    expect(bytesToHex(withNonce)).toContain('0203008001');
    expect(bytesToHex(timestampRequest(digest, Uint8Array.from([0x7f])))).toContain('02017f');
    expect(bytesToHex(timestampRequest(digest, new Uint8Array(0)))).toContain('02000101ff');
    expect(() => timestampRequest(new Uint8Array(20))).toThrow(AnchorError);
  });

  it('encodes long DER lengths and reads them back', () => {
    const short = der(0x04, new Uint8Array(0x7f));
    expect(short[1]).toBe(0x7f);
    const medium = der(0x04, new Uint8Array(0x80));
    expect([medium[1], medium[2]]).toEqual([0x81, 0x80]);
    const long = der(0x04, new Uint8Array(0x1234));
    expect([long[1], long[2], long[3]]).toEqual([0x82, 0x12, 0x34]);
    expect(readTlv(long, 0)).toEqual({ tag: 0x04, start: 4, end: 4 + 0x1234 });
    expect(readTlv(medium, 0)).toEqual({ tag: 0x04, start: 3, end: 3 + 0x80 });
    expect(() => der(0x04, new Uint8Array(0x10000))).toThrow('too long');
    expect(() => readTlv(new Uint8Array([0x30]), 0)).toThrow('truncated');
    expect(() => readTlv(new Uint8Array([0x30, 0x83, 1, 1, 1]), 0)).toThrow('not supported');
    expect(() => readTlv(new Uint8Array([0x30, 0x80]), 0)).toThrow('not supported');
    expect(() => readTlv(new Uint8Array([0x30, 0x82, 0x01]), 0)).toThrow('truncated');
    expect(() => readTlv(new Uint8Array([0x30, 0x81, 0x05, 1]), 0)).toThrow('truncated');
    expect(() => readTlv(new Uint8Array([0x30, 0x05, 1]), 0)).toThrow('truncated');
  });
});

describe('readTimestampResponse', () => {
  it('reads the status, the token and whether the imprint is inside it', async () => {
    const granted = readTimestampResponse(await fakeTsa(0)(timestampRequest(digest)), digest);
    expect(granted).toEqual({ status: 'granted', hasToken: true, imprintPresent: true });
    const mods = readTimestampResponse(await fakeTsa(1)(timestampRequest(digest)), digest);
    expect(mods.status).toBe('grantedWithMods');
    const rejected = readTimestampResponse(
      await fakeTsa(2, { token: false })(timestampRequest(digest)),
      digest,
    );
    expect(rejected).toEqual({ status: 'rejection', hasToken: false, imprintPresent: false });
    const other = readTimestampResponse(await fakeTsa(9)(timestampRequest(digest)), digest);
    expect(other.status).toBe('unknown');
    const missing = readTimestampResponse(
      await fakeTsa(0, { imprint: false })(timestampRequest(digest)),
      digest,
    );
    expect(missing.imprintPresent).toBe(false);
    expect(() => readTimestampResponse(der(0x04, new Uint8Array(1)), digest)).toThrow(
      'not a TimeStampResp',
    );
    expect(() => readTimestampResponse(der(0x30, der(0x04, new Uint8Array(1))), digest)).toThrow(
      'not a PKIStatusInfo',
    );
    expect(() =>
      readTimestampResponse(der(0x30, der(0x30, der(0x04, new Uint8Array(1)))), digest),
    ).toThrow('small integer');
    expect(() =>
      readTimestampResponse(der(0x30, der(0x30, der(0x02, new Uint8Array(2)))), digest),
    ).toThrow('small integer');
  });
});

describe('rfc3161Anchorer', () => {
  it('anchors a checkpoint through a fake TSA and the signature covers the anchor', async () => {
    const nonces: Uint8Array[] = [];
    const anchorer = rfc3161Anchorer(fakeTsa(0), () => {
      const nonce = Uint8Array.from([7, 7, 7, 7]);
      nonces.push(nonce);
      return nonce;
    });
    expect(anchorer.kind).toBe('rfc3161');
    const keypair = generateKeypair(new Uint8Array(32).fill(2));
    const body = { ...unsigned, keyId: keypair.keyId };
    const anchor = await anchorer.anchor({
      digest: anchorDigest(body),
      tenantId: 't',
      treeSize: 49,
    });
    expect(anchor?.kind).toBe('rfc3161');
    expect(nonces).toHaveLength(1);
    const signed = signCheckpoint(
      { ...unsigned, ...(anchor === undefined ? {} : { anchor }) },
      keypair.secretKey,
    );
    expect(signed.anchor).toEqual(anchor);
    expect(
      verifyCheckpoint(signed, [
        { keyId: keypair.keyId, alg: 'ed25519', publicKey: bytesToHex(keypair.publicKey) },
      ]),
    ).toEqual({ ok: true, keyId: keypair.keyId });
    const tampered = { ...signed, anchor: { kind: 'rfc3161' as const, ref: 'AAAA' } };
    expect(
      verifyCheckpoint(tampered, [
        { keyId: keypair.keyId, alg: 'ed25519', publicKey: bytesToHex(keypair.publicKey) },
      ]).ok,
    ).toBe(false);
    expect(readAnchor(signed)).toEqual({ status: 'granted', hasToken: true, imprintPresent: true });
    expect(readAnchor({ ...signed, anchor: undefined })).toBeUndefined();
    expect(readAnchor({ ...signed, anchor: { kind: 'rekor', ref: 'x' } })).toBeUndefined();
    expect(fromBase64(anchor!.ref)).toEqual(await fakeTsa(0)(timestampRequest(anchorDigest(body))));
  });

  it('refuses a rejection, a granted answer without a token, and a token without the digest', async () => {
    const request = { digest, tenantId: 't', treeSize: 1 };
    await expect(rfc3161Anchorer(fakeTsa(2, { token: false })).anchor(request)).rejects.toThrow(
      'timestamp rejection',
    );
    await expect(rfc3161Anchorer(fakeTsa(0, { token: false })).anchor(request)).rejects.toThrow(
      'without a token',
    );
    await expect(rfc3161Anchorer(fakeTsa(0, { imprint: false })).anchor(request)).rejects.toThrow(
      'does not carry the digest',
    );
    await expect(rfc3161Anchorer(fakeTsa(1)).anchor(request)).resolves.toMatchObject({
      kind: 'rfc3161',
    });
  });
});
