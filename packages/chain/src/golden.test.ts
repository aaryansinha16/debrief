import { eventSchema } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import golden from '../__golden__/chain-vectors.json';
import { canonicalize } from './canonicalize.js';
import { nineSecondsFixture } from './fixtures.js';
import { GENESIS_HASH, chainEvents, hashEvent } from './hash.js';

const events = eventSchema.array().parse(golden.events);

describe('chain golden vectors', () => {
  it('holds ten schema-valid events chained from genesis', () => {
    expect(events).toHaveLength(10);
    expect(events[0]!.prevHash).toBe(GENESIS_HASH);
    expect(golden.canonical).toHaveLength(10);
  });

  it('reproduces every canonical form and hash link', () => {
    let prev = GENESIS_HASH;
    events.forEach((event, i) => {
      const { hash, ...unhashed } = event;
      expect(event.seq).toBe(i);
      expect(event.prevHash).toBe(prev);
      expect(canonicalize(unhashed)).toBe(golden.canonical[i]);
      expect(JSON.parse(golden.canonical[i]!)).toEqual(unhashed);
      expect(hashEvent(prev, event)).toBe(hash);
      prev = hash;
    });
  });

  it('is what chainEvents produces from the fixture', () => {
    expect(chainEvents(nineSecondsFixture())).toEqual(events);
  });
});
