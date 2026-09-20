import { generateKeypair, signBytes } from '@debrief/chain';
import { FILES, packBundle, unpackBundle, verifyBundle } from '@debrief/evidence';
import { demoBundle } from '@debrief/evidence/fixtures';
import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  chainLinks,
  findHash,
  keyIdMatches,
  keyStatus,
  pinFailure,
  unreadable,
  verifyZip,
} from './flow.js';

const demo = demoBundle();
const good = packBundle(demo.input, demo.sign);

const edited = (): Uint8Array => {
  const files = unzipSync(good);
  const lines = new TextDecoder().decode(files[FILES.events]).trimEnd().split('\n');
  const target = JSON.parse(lines[7]!) as { summary?: string };
  lines[7] = JSON.stringify({ ...target, summary: 'edited' });
  return zipSync({ ...files, [FILES.events]: new TextEncoder().encode(`${lines.join('\n')}\n`) });
};

describe('verifyZip', () => {
  it('verifies the demo bundle, pins an edited event to its seq and reports junk as unreadable', () => {
    const verified = verifyZip(good);
    expect(verified.kind).toBe('verified');
    const broken = verifyZip(edited());
    expect(broken.kind).toBe('broken');
    if (broken.kind === 'broken') {
      expect(broken.failedAt.name).toBe('event-hash');
      expect(broken.failedAt.seq).toBe(demo.runEvents[7]!.seq);
      expect(broken.verdict.failedAt?.name).toBe('file-digest');
    }
    const junk = verifyZip(new Uint8Array([1, 2, 3]));
    expect(junk).toEqual({ kind: 'unreadable', file: 'bundle.zip', message: 'not a zip' });
    const files = unzipSync(good);
    delete files[FILES.report];
    expect(verifyZip(zipSync(files))).toEqual({
      kind: 'unreadable',
      file: 'report.md',
      message: 'missing',
    });
  });

  it('rethrows anything that is not a bundle format error', () => {
    expect(() => unreadable(new Error('boom'))).toThrow('boom');
  });

  it('prefers a failure with a seq, else the first failure, else nothing', () => {
    const bundle = unpackBundle(good);
    expect(pinFailure(verifyBundle(bundle))).toBeUndefined();
    const forged = packBundle(demo.input, (digest) =>
      signBytes(digest, generateKeypair(new Uint8Array(32).fill(5)).secretKey),
    );
    expect(pinFailure(verifyBundle(unpackBundle(forged)))?.name).toBe('manifest-signature');
  });
});

describe('chainLinks', () => {
  it('lights every link of a verified bundle and stops at the first broken seq', () => {
    const verified = verifyZip(good);
    if (verified.kind !== 'verified') throw new Error('expected verified');
    const links = chainLinks(verified.bundle, verified.verdict);
    expect(links).toHaveLength(demo.runEvents.length);
    expect(links.every((link) => link.state === 'ok')).toBe(true);
    expect(links[0]).toMatchObject({ seq: demo.runEvents[0]!.seq, kind: demo.runEvents[0]!.kind });
    const broken = verifyZip(edited());
    if (broken.kind !== 'broken') throw new Error('expected broken');
    const states = chainLinks(broken.bundle, broken.verdict).map((link) => link.state);
    expect(states.slice(0, 7)).toEqual(new Array<string>(7).fill('ok'));
    expect(states[7]).toBe('broken');
    expect(new Set(states.slice(8))).toEqual(new Set(['unreached']));
  });
});

describe('findHash', () => {
  const verified = verifyZip(good);
  if (verified.kind !== 'verified') throw new Error('expected verified');
  const { bundle, verdict } = verified;

  it('finds events by hash or id, checkpoints by root or head, and nothing otherwise', () => {
    const event = demo.runEvents[5]!;
    expect(findHash(bundle, verdict, ` ${event.hash.toUpperCase()} `)).toEqual({
      kind: 'event',
      seq: event.seq,
      id: event.id,
      proven: true,
    });
    expect(findHash(bundle, verdict, event.id.toLowerCase())).toMatchObject({ kind: 'event' });
    expect(findHash(bundle, verdict, demo.checkpoints[0]!.rootHash)).toEqual({
      kind: 'checkpoint-root',
      treeSize: 30,
    });
    const head = demo.checkpoints[1]!.headHash;
    expect(findHash(bundle, verdict, head)).toMatchObject({ kind: 'event', seq: 48 });
    const withoutLast = { ...bundle, events: bundle.events.filter((event) => event.seq !== 48) };
    expect(findHash(withoutLast, verdict, head)).toEqual({ kind: 'checkpoint-head', treeSize: 49 });
    expect(findHash(bundle, verdict, 'ff'.repeat(32))).toEqual({ kind: 'none' });
    expect(findHash(bundle, verdict, '   ')).toEqual({ kind: 'none' });
    const unproven = findHash(bundle, { ...verdict, checks: [] }, event.hash);
    expect(unproven).toMatchObject({ kind: 'event', proven: false });
  });
});

describe('keys', () => {
  const bundle = unpackBundle(good);

  it('confirms a published key, flags a mismatch or an unknown key, and checks the key id derivation', () => {
    const entry = {
      keyId: bundle.manifest.keyId,
      alg: 'ed25519',
      publicKey: bundle.manifest.publicKey,
    };
    expect(keyStatus(bundle, [entry])).toEqual({ kind: 'confirmed', keyId: entry.keyId });
    expect(keyStatus(bundle, [{ ...entry, publicKey: 'ab'.repeat(32) }])).toEqual({
      kind: 'mismatch',
      keyId: entry.keyId,
    });
    expect(keyStatus(bundle, [{ ...entry, alg: 'rsa' }])).toEqual({
      kind: 'mismatch',
      keyId: entry.keyId,
    });
    expect(keyStatus(bundle, [])).toEqual({ kind: 'unknown', keyId: entry.keyId });
    expect(keyIdMatches(bundle)).toBe(true);
    expect(keyIdMatches({ ...bundle, manifest: { ...bundle.manifest, keyId: 'nope' } })).toBe(
      false,
    );
    expect(keyIdMatches({ ...bundle, manifest: { ...bundle.manifest, publicKey: 'zz' } })).toBe(
      false,
    );
  });
});
