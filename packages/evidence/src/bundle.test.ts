import { generateKeypair, hashEvent, sha256Hex, signBytes } from '@debrief/chain';
import type { Event } from '@debrief/schema';
import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { demoBundle } from './__fixtures__/demo-bundle.js';
import {
  BLOB_DIR,
  type Bundle,
  BundleFormatError,
  FILES,
  packBundle,
  unpackBundle,
} from './bundle.js';
import { bytesToHex, hexToBytes, utf8 } from './hex.js';
import { verifyBundle } from './verify.js';

const demo = demoBundle();
const zip = packBundle(demo.input, demo.sign);

// Re-zips the bundle with some files replaced or dropped, without touching the manifest or signature unless asked.
const rezip = (
  changes: Record<string, Uint8Array | null>,
  base: Record<string, Uint8Array> = unzipSync(zip),
): Uint8Array => {
  const files = { ...base };
  for (const [name, bytes] of Object.entries(changes)) {
    if (bytes === null) delete files[name];
    else files[name] = bytes;
  }
  return zipSync(files);
};

// A forger with the original key material fixes the digests and the signature; the chain must still catch the change.
const reseal = (files: Record<string, Uint8Array>, secretKey = demo.secretKey): Uint8Array => {
  const manifest = JSON.parse(utf8.decode(files[FILES.manifest]!)) as {
    files: Record<string, string>;
  };
  for (const name of Object.keys(manifest.files)) {
    manifest.files[name] = sha256Hex(files[name]!);
  }
  const manifestBytes = utf8.encode(JSON.stringify(manifest, null, 2));
  const signature = bytesToHex(signBytes(hexToBytes(sha256Hex(manifestBytes)), secretKey));
  return zipSync({
    ...files,
    [FILES.manifest]: manifestBytes,
    [FILES.signature]: utf8.encode(`${signature}\n`),
  });
};

describe('packBundle', () => {
  it('writes the §12 files, digests every one of them in the manifest and signs the manifest', () => {
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual([
      'SIGNATURE',
      'checkpoints.json',
      'events.jsonl',
      'manifest.json',
      'proofs.json',
      'regulation_map.json',
      'report.md',
    ]);
    const manifest = JSON.parse(utf8.decode(files[FILES.manifest]!)) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      version: '1',
      tenantId: 'tenant-demo',
      runIds: demo.input.runIds,
      keyId: demo.input.keyId,
      publicKey: demo.input.publicKey,
      alg: 'ed25519',
      redaction: { summaries: true, includeContent: false },
      generatedAt: '2026-09-17T12:00:00.000Z',
    });
    expect(manifest.timeRange).toEqual({
      from: demo.runEvents[0]!.ts,
      to: [...demo.runEvents]
        .map((event) => event.ts)
        .sort()
        .at(-1),
    });
    expect(Object.keys(manifest.files as object)).toEqual([
      'checkpoints.json',
      'events.jsonl',
      'proofs.json',
      'regulation_map.json',
      'report.md',
    ]);
    const lines = utf8.decode(files[FILES.events]!).trimEnd().split('\n');
    expect(lines).toHaveLength(demo.runEvents.length);
    expect(JSON.parse(lines[0]!)).toEqual(demo.runEvents[0]);
    expect(packBundle(demo.input, demo.sign)).toEqual(zip);
  });

  it('includes sealed content only when the export policy says so', () => {
    const sha = 'ab'.repeat(32);
    const document = { sourceId: 's', content: { 'gen_ai.input.messages': '[secret:abcd1234]' } };
    const withContent = packBundle(
      { ...demo.input, policy: { includeContent: true }, blobs: { [sha]: document } },
      demo.sign,
    );
    const files = unzipSync(withContent);
    expect(files[`${BLOB_DIR}${sha}.json`]).toBeDefined();
    const unpacked = unpackBundle(withContent);
    expect(unpacked.blobs[sha]).toEqual(document);
    expect(unpacked.manifest.redaction.includeContent).toBe(true);
    expect(unpacked.manifest.files[`${BLOB_DIR}${sha}.json`]).toBeDefined();
    const without = packBundle({ ...demo.input, blobs: { [sha]: document } }, demo.sign);
    const none = packBundle({ ...demo.input, policy: { includeContent: true } }, demo.sign);
    expect(unpackBundle(none).manifest.redaction.includeContent).toBe(true);
    expect(unpackBundle(none).blobs).toEqual({});
    expect(Object.keys(unzipSync(without)).some((name) => name.startsWith(BLOB_DIR))).toBe(false);
    expect(unpackBundle(without).blobs).toEqual({});
  });

  it('survives an unparseable or out-of-range generatedAt by dating the zip entries in 2000', () => {
    for (const generatedAt of [
      'not a date',
      '1970-01-01T00:00:00.000Z',
      '2150-01-01T00:00:00.000Z',
    ]) {
      const odd = packBundle({ ...demo.input, generatedAt, events: [] }, demo.sign);
      const unpacked = unpackBundle(odd);
      expect(unpacked.manifest.timeRange).toEqual({ from: generatedAt, to: generatedAt });
      expect(unpacked.events).toEqual([]);
    }
  });
});

describe('unpackBundle', () => {
  it('reads everything back', () => {
    const bundle = unpackBundle(zip);
    expect(bundle.events).toEqual(demo.runEvents);
    expect(bundle.checkpoints).toEqual(demo.checkpoints);
    expect(bundle.proofs).toEqual(demo.input.proofs);
    expect(bundle.report).toBe(demo.input.report);
    expect(bundle.regulationMap).toEqual(demo.input.regulationMap);
    expect(bundle.signature).toMatch(/^[0-9a-f]{128}$/);
    expect(bundle.manifest.keyId).toBe(demo.input.keyId);
  });

  it('names the file that is missing or malformed', () => {
    expect(() => unpackBundle(new Uint8Array([1, 2, 3]))).toThrow('bundle.zip: not a zip');
    expect(() => unpackBundle(rezip({ [FILES.manifest]: null }))).toThrow('manifest.json: missing');
    expect(() => unpackBundle(rezip({ [FILES.manifest]: utf8.encode('{') }))).toThrow(
      /^manifest\.json: /,
    );
    expect(() => unpackBundle(rezip({ [FILES.manifest]: utf8.encode('{"version":"9"}') }))).toThrow(
      /^manifest\.json: /,
    );
    expect(() => unpackBundle(rezip({ [FILES.events]: utf8.encode('{"seq":1}\n') }))).toThrow(
      /^events\.jsonl:1: /,
    );
    expect(() => unpackBundle(rezip({ [FILES.proofs]: null }))).toThrow('proofs.json: missing');
    expect(() => unpackBundle(rezip({ [FILES.checkpoints]: utf8.encode('[]x') }))).toThrow(
      /^checkpoints\.json: /,
    );
    const badBlob = rezip({ [`${BLOB_DIR}x.json`]: utf8.encode('{"content":1}') });
    expect(() => unpackBundle(badBlob)).toThrow(/^blobs\/x\.json: /);
    const stray = unpackBundle(rezip({ [`${BLOB_DIR}notes.txt`]: utf8.encode('hi') }));
    expect(stray.blobs).toEqual({});
  });
});

describe('verifyBundle', () => {
  it('verifies the demo bundle with the chain package alone', () => {
    const verdict = verifyBundle(unpackBundle(zip));
    expect(verdict.ok).toBe(true);
    expect(verdict.failedAt).toBeUndefined();
    expect(verdict.events).toBe(demo.runEvents.length);
    expect(verdict.checkpoints).toBe(2);
    const names = new Set(verdict.checks.map((check) => check.name));
    expect([...names].sort()).toEqual([
      'checkpoint-consistency',
      'checkpoint-signature',
      'event-hash',
      'event-inclusion',
      'event-order',
      'file-digest',
      'manifest-signature',
    ]);
    expect(verdict.checks.every((check) => check.ok)).toBe(true);
    expect(verdict.checks.filter((check) => check.name === 'event-inclusion')).toHaveLength(
      demo.runEvents.length,
    );
  });

  it('fails when any byte of events.jsonl changes', () => {
    const original = unzipSync(zip)[FILES.events]!;
    for (const offset of [0, 17, Math.floor(original.length / 2), original.length - 1]) {
      const altered = original.slice();
      altered[offset] = altered[offset] === 0x20 ? 0x21 : 0x20;
      let verdict;
      try {
        verdict = verifyBundle(unpackBundle(rezip({ [FILES.events]: altered })));
      } catch (error) {
        expect(error).toBeInstanceOf(BundleFormatError);
        continue;
      }
      expect(verdict.ok).toBe(false);
      expect(verdict.failedAt).toMatchObject({ name: 'file-digest', subject: 'events.jsonl' });
    }
  });

  it('pins the seq when a resealed event no longer hashes, and the proof when its hash is patched too', () => {
    const files = unzipSync(zip);
    const lines = utf8.decode(files[FILES.events]!).trimEnd().split('\n');
    const target = JSON.parse(lines[5]!) as Event;
    const edited: Event = { ...target, summary: 'the agent did something else' };
    lines[5] = JSON.stringify(edited);
    const resealed = reseal({ ...files, [FILES.events]: utf8.encode(`${lines.join('\n')}\n`) });
    const verdict = verifyBundle(unpackBundle(resealed));
    expect(verdict.ok).toBe(false);
    expect(verdict.failedAt).toMatchObject({ name: 'event-hash', seq: target.seq });
    const { hash: _hash, prevHash, ...rest } = edited;
    const rehashed: Event = { ...edited, hash: hashEvent(prevHash, rest) };
    lines[5] = JSON.stringify(rehashed);
    const patched = reseal({ ...files, [FILES.events]: utf8.encode(`${lines.join('\n')}\n`) });
    const again = verifyBundle(unpackBundle(patched));
    expect(again.ok).toBe(false);
    expect(again.failedAt).toMatchObject({ name: 'event-inclusion', seq: target.seq });
    expect(
      again.checks.filter((check) => check.name === 'event-hash').every((check) => check.ok),
    ).toBe(true);
  });

  it('rejects a bundle resealed by another key: the checkpoints no longer verify', () => {
    const files = unzipSync(zip);
    const other = generateKeypair(new Uint8Array(32).fill(7));
    const manifest = JSON.parse(utf8.decode(files[FILES.manifest]!)) as Record<string, unknown>;
    manifest.keyId = other.keyId;
    manifest.publicKey = bytesToHex(other.publicKey);
    const forged = reseal(
      { ...files, [FILES.manifest]: utf8.encode(JSON.stringify(manifest, null, 2)) },
      other.secretKey,
    );
    const verdict = verifyBundle(unpackBundle(forged));
    expect(verdict.ok).toBe(false);
    expect(verdict.checks.find((check) => check.name === 'manifest-signature')?.ok).toBe(true);
    expect(verdict.failedAt).toMatchObject({ name: 'checkpoint-signature', detail: 'unknown-key' });
  });

  it('flags a bad detached signature, a stray file, a missing proof or checkpoint, and reordered events', () => {
    const badSignature = verifyBundle(
      unpackBundle(rezip({ [FILES.signature]: utf8.encode('00'.repeat(64)) })),
    );
    expect(badSignature.failedAt).toMatchObject({ name: 'manifest-signature' });
    const notHex = verifyBundle(unpackBundle(rezip({ [FILES.signature]: utf8.encode('zz') })));
    expect(notHex.failedAt).toMatchObject({ name: 'manifest-signature' });
    const stray = verifyBundle(unpackBundle(rezip({ 'extra.txt': utf8.encode('hi') })));
    expect(stray.failedAt).toMatchObject({
      name: 'file-digest',
      subject: 'extra.txt',
      detail: 'not in the manifest',
    });
    expect(() => unpackBundle(rezip({ [FILES.report]: null }))).toThrow('report.md: missing');
    const sha = 'cd'.repeat(32);
    const sealed = packBundle(
      {
        ...demo.input,
        policy: { includeContent: true },
        blobs: { [sha]: { sourceId: 's', content: {} } },
      },
      demo.sign,
    );
    const missing = verifyBundle(
      unpackBundle(rezip({ [`${BLOB_DIR}${sha}.json`]: null }, unzipSync(sealed))),
    );
    expect(missing.failedAt).toMatchObject({
      name: 'file-digest',
      subject: `blobs/${sha}.json`,
      detail: 'missing',
    });

    const bundle = unpackBundle(zip);
    const withoutProofs: Bundle = { ...bundle, proofs: { inclusion: [], consistency: [] } };
    const noProof = verifyBundle(withoutProofs);
    expect(noProof.failedAt).toMatchObject({
      name: 'event-inclusion',
      detail: 'no inclusion proof',
    });
    const wrongSize: Bundle = {
      ...bundle,
      proofs: {
        inclusion: bundle.proofs.inclusion.map((proof) => ({ ...proof, treeSize: 999 })),
        consistency: [{ first: 1, second: 999, proof: [] }],
      },
    };
    const sized = verifyBundle(wrongSize);
    expect(sized.checks.find((check) => check.name === 'checkpoint-consistency')).toMatchObject({
      ok: false,
      detail: 'checkpoint missing',
    });
    expect(sized.checks.find((check) => check.name === 'event-inclusion')?.detail).toBe(
      'no checkpoint of size 999',
    );
    const badConsistency = verifyBundle({
      ...bundle,
      proofs: { ...bundle.proofs, consistency: [{ first: 30, second: 49, proof: [] }] },
    });
    expect(
      badConsistency.checks.find((check) => check.name === 'checkpoint-consistency'),
    ).toMatchObject({ ok: false, detail: 'proof does not verify' });
    const reordered = verifyBundle({ ...bundle, events: [...bundle.events].reverse() });
    expect(
      reordered.checks.find((check) => check.name === 'event-order' && !check.ok),
    ).toMatchObject({
      seq: bundle.events.at(-2)!.seq,
    });
    const manifestless: Bundle = { ...bundle, files: { ...bundle.files } };
    delete manifestless.files[FILES.manifest];
    expect(
      verifyBundle(manifestless).checks.find((check) => check.name === 'manifest-signature')?.ok,
    ).toBe(false);
  });

  it('checks that sealed content hashes to its name', () => {
    const sha = 'ab'.repeat(32);
    const document = { sourceId: 's', content: { k: 'v' } };
    const withContent = unpackBundle(
      packBundle(
        { ...demo.input, policy: { includeContent: true }, blobs: { [sha]: document } },
        demo.sign,
      ),
    );
    const mismatch = verifyBundle(withContent);
    expect(mismatch.failedAt).toMatchObject({ name: 'blob-digest', subject: `blobs/${sha}.json` });
    const real = sha256Hex(utf8.encode(JSON.stringify(document.content)));
    const honest = unpackBundle(
      packBundle(
        { ...demo.input, policy: { includeContent: true }, blobs: { [real]: document } },
        demo.sign,
      ),
    );
    expect(verifyBundle(honest).ok).toBe(true);
  });
});

describe('hex', () => {
  it('round-trips and rejects odd or non-hex input', () => {
    expect(bytesToHex(hexToBytes('00ff10'))).toBe('00ff10');
    expect(() => hexToBytes('abc')).toThrow('not hex');
    expect(() => hexToBytes('zz')).toThrow('not hex');
    expect(hexToBytes('')).toEqual(new Uint8Array(0));
  });
});
