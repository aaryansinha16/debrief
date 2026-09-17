import { describe, expect, it } from 'vitest';

import { hashSeed, mulberry32, seededRandom } from './random.js';

describe('seeded random', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = seededRandom('nine-seconds');
    const b = seededRandom('nine-seconds');
    const c = seededRandom('other');
    const stream = (next: () => number): number[] => Array.from({ length: 5 }, () => next());
    expect(stream(a)).toEqual(stream(b));
    expect(stream(seededRandom('nine-seconds'))).not.toEqual(stream(c));
    expect(hashSeed('')).toBe(0x811c9dc5);
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
    const values = Array.from({ length: 1000 }, mulberry32(42));
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(990);
  });
});
