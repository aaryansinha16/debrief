import { eventSchema, type Event } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import golden from '../__golden__/chain-vectors.json';
import { nineSecondsFixture } from './fixtures.js';
import { GENESIS_HASH, chainEvents, hashEvent } from './hash.js';
import { verifyChain } from './verify.js';

const chain = (): Event[] => chainEvents(nineSecondsFixture());

function mutate(value: unknown): unknown {
  if (typeof value === 'string') return `${value}x`;
  if (typeof value === 'number') return value + 1;
  if (typeof value === 'boolean') return !value;
  if (Array.isArray(value)) return [...(value as unknown[]), 'x'];
  const record = value as Record<string, unknown>;
  const [key] = Object.keys(record);
  return { ...record, [key!]: mutate(record[key!]) };
}

describe('verifyChain', () => {
  it('accepts the fixture chain and reports its head', () => {
    const events = chain();
    expect(verifyChain(events)).toEqual({ ok: true, length: 10, headHash: events[9]!.hash });
    expect(verifyChain(events, { headHash: events[9]!.hash }).ok).toBe(true);
  });

  it('accepts the golden vectors against their recorded head', () => {
    const events = eventSchema.array().parse(golden.events);
    expect(verifyChain(events, { headHash: events[9]!.hash })).toEqual({
      ok: true,
      length: 10,
      headHash: events[9]!.hash,
    });
  });

  it('accepts an empty chain', () => {
    expect(verifyChain([])).toEqual({ ok: true, length: 0, headHash: GENESIS_HASH });
    expect(verifyChain([], { prevHash: 'ab'.repeat(32), startSeq: 5 })).toEqual({
      ok: true,
      length: 0,
      headHash: 'ab'.repeat(32),
    });
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])(
    'detects a change to any field of event %i at that seq',
    (seq) => {
      const fields = Object.keys(chain()[seq]!).filter(
        (key) => !['seq', 'prevHash', 'hash'].includes(key),
      );
      expect(fields.length).toBeGreaterThan(8);
      for (const field of fields) {
        const events = chain();
        const target = events[seq] as unknown as Record<string, unknown>;
        target[field] = mutate(target[field]);
        expect(verifyChain(events), `mutated ${field}`).toEqual({ ok: false, seq, reason: 'hash' });
        const removed = chain();
        delete (removed[seq] as unknown as Record<string, unknown>)[field];
        expect(verifyChain(removed), `removed ${field}`).toEqual({
          ok: false,
          seq,
          reason: 'hash',
        });
      }
      const added = chain();
      (added[seq] as unknown as Record<string, unknown>).extra = true;
      expect(verifyChain(added)).toEqual({ ok: false, seq, reason: 'hash' });
    },
  );

  it('reports the seq of a tampered seq, prevHash or hash field', () => {
    const seqTamper = chain();
    seqTamper[4]!.seq = 40;
    expect(verifyChain(seqTamper)).toEqual({ ok: false, seq: 4, reason: 'seq' });

    const prevTamper = chain();
    prevTamper[4]!.prevHash = 'ab'.repeat(32);
    expect(verifyChain(prevTamper)).toEqual({ ok: false, seq: 4, reason: 'prev-hash' });

    const hashTamper = chain();
    hashTamper[4]!.hash = 'ab'.repeat(32);
    expect(verifyChain(hashTamper)).toEqual({ ok: false, seq: 4, reason: 'hash' });
  });

  it('detects a tamper whose hash was recomputed at the next link', () => {
    const events = chain();
    events[4]!.summary = 'rewritten';
    events[4]!.hash = hashEvent(events[3]!.hash, events[4]!);
    expect(verifyChain(events)).toEqual({ ok: false, seq: 5, reason: 'prev-hash' });
  });

  it('detects reordering at the first displaced seq', () => {
    const swapped = chain();
    [swapped[2], swapped[7]] = [swapped[7]!, swapped[2]!];
    expect(verifyChain(swapped)).toEqual({ ok: false, seq: 2, reason: 'seq' });

    const adjacent = chain();
    [adjacent[5], adjacent[6]] = [adjacent[6]!, adjacent[5]!];
    expect(verifyChain(adjacent)).toEqual({ ok: false, seq: 5, reason: 'seq' });

    expect(verifyChain(chain().reverse())).toEqual({ ok: false, seq: 0, reason: 'seq' });
  });

  it('detects deletion at the missing seq', () => {
    for (const seq of [0, 3, 8]) {
      const events = chain();
      events.splice(seq, 1);
      expect(verifyChain(events)).toEqual({ ok: false, seq, reason: 'seq' });
    }
  });

  it('detects deletion of the last event only against a known head', () => {
    const full = chain();
    const truncated = full.slice(0, 9);
    expect(verifyChain(truncated).ok).toBe(true);
    expect(verifyChain(truncated, { headHash: full[9]!.hash })).toEqual({
      ok: false,
      seq: 9,
      reason: 'head',
    });
  });

  it('detects a duplicated event', () => {
    const events = chain();
    events.splice(3, 0, events[3]!);
    expect(verifyChain(events)).toEqual({ ok: false, seq: 4, reason: 'seq' });
  });

  it('verifies a slice only when its start is pinned', () => {
    const full = chain();
    const slice = full.slice(4, 8);
    expect(verifyChain(slice)).toEqual({ ok: false, seq: 0, reason: 'seq' });
    expect(verifyChain(slice, { startSeq: 4, prevHash: full[3]!.hash })).toEqual({
      ok: true,
      length: 4,
      headHash: full[7]!.hash,
    });
    expect(verifyChain(slice, { startSeq: 4, prevHash: full[2]!.hash })).toEqual({
      ok: false,
      seq: 4,
      reason: 'prev-hash',
    });
  });
});
