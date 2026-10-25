import { eventSchema } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import golden from '../__golden__/witness-vectors.json';
import { canonicalize } from './canonicalize.js';
import { GENESIS_HASH, chainEvents, hashEvent } from './hash.js';
import { witnessFixture } from './witness-fixtures.js';

const events = eventSchema.array().parse(golden.events);

describe('witness kind golden vectors (D-083)', () => {
  it('holds one schema-valid event of each new kind', () => {
    expect(events.map((event) => `${event.provenance}:${event.kind}`)).toEqual([
      'observed:world.change',
      'observed:world.read',
      'derived:claim',
      'derived:verdict',
    ]);
    expect(golden.canonical).toHaveLength(events.length);
  });

  it('reproduces every canonical form and hash link', () => {
    let prev = GENESIS_HASH;
    events.forEach((event, i) => {
      const { hash, ...unhashed } = event;
      expect(event.prevHash).toBe(prev);
      expect(canonicalize(unhashed)).toBe(golden.canonical[i]);
      expect(hashEvent(prev, event)).toBe(hash);
      prev = hash;
    });
  });

  it('is what chainEvents produces from the fixture', () => {
    expect(chainEvents(witnessFixture())).toEqual(events);
  });
});
