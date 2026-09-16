import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';

import { canonicalize } from './canonicalize.js';
import { ChainError } from './errors.js';
import { GENESIS_HASH, chainEvents, hashEvent, sha256Hex, type UnhashedEvent } from './hash.js';

const sample: UnhashedEvent = {
  id: '01J8ZK5R4M2X6P9Q3V7W1Y5N00',
  tenantId: 'tenant-a',
  seq: 0,
  ts: '2026-09-17T00:00:00.000Z',
  sourceTs: '2026-09-17T00:00:00.000Z',
  source: 'api',
  provenance: 'reported',
  runId: '4bf92f3577b34da6a3ce929d0e0e4736',
  kind: 'agent.invoke',
  actor: { type: 'agent', id: 'agent:a' },
  attrs: { n: 1, b: true, s: 'x' },
};

describe('hashEvent', () => {
  it('uses 64 zeros as the genesis hash', () => {
    expect(GENESIS_HASH).toMatch(/^0{64}$/);
  });

  it('hashes bytes(prevHash) followed by utf8(canonical(event with prevHash, without hash))', () => {
    const canonical = canonicalize({ ...sample, prevHash: GENESIS_HASH });
    const expected = bytesToHex(
      sha256(concatBytes(hexToBytes(GENESIS_HASH), utf8ToBytes(canonical))),
    );
    expect(hashEvent(GENESIS_HASH, sample)).toBe(expected);
    expect(sha256Hex(utf8ToBytes('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('ignores a hash or prevHash already present on the event', () => {
    const stale = { ...sample, prevHash: 'ef'.repeat(32), hash: 'ab'.repeat(32) };
    expect(hashEvent(GENESIS_HASH, stale)).toBe(hashEvent(GENESIS_HASH, sample));
    expect(hashEvent('cd'.repeat(32), stale)).toBe(hashEvent('cd'.repeat(32), sample));
  });

  it.each(['AB'.repeat(32), 'ab'.repeat(31), '', 'zz'.repeat(32)])(
    'rejects prevHash %j',
    (prevHash) => {
      expect(() => hashEvent(prevHash, sample)).toThrow(ChainError);
    },
  );

  it('changes when the prevHash or any field changes', () => {
    const base = hashEvent(GENESIS_HASH, sample);
    expect(hashEvent('ab'.repeat(32), sample)).not.toBe(base);
    expect(hashEvent(GENESIS_HASH, { ...sample, summary: 'x' })).not.toBe(base);
    expect(hashEvent(GENESIS_HASH, { ...sample, attrs: { ...sample.attrs, k: 1 } })).not.toBe(base);
  });
});

describe('chainEvents', () => {
  const three = [sample, { ...sample, seq: 1 }, { ...sample, seq: 2 }];

  it('links each event to the previous hash starting from genesis', () => {
    const events = chainEvents(three);
    expect(events).toHaveLength(3);
    expect(events[0]!.prevHash).toBe(GENESIS_HASH);
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i]!.prevHash).toBe(events[i - 1]!.hash);
      expect(events[i]!.hash).toBe(hashEvent(events[i - 1]!.hash, events[i]!));
    }
    expect(new Set(events.map((event) => event.hash)).size).toBe(3);
  });

  it('can continue from a given prevHash', () => {
    const start = 'cd'.repeat(32);
    const [first] = chainEvents(three.slice(0, 1), start);
    expect(first!.prevHash).toBe(start);
    expect(first!.hash).toBe(hashEvent(start, sample));
  });
});
