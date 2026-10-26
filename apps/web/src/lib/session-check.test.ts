import { describe, expect, it } from 'vitest';

import { checkCountsSchema, claimStateSchema } from './session-check';

describe('the session check view model', () => {
  it('gives a claim one of five states and counts in whole numbers', () => {
    expect(claimStateSchema.options).toEqual([
      'contradicted',
      'holds',
      'no-witness',
      'pending',
      'hedged',
    ]);
    const counts = {
      claims: 7,
      holds: 4,
      contradicted: 2,
      noWitness: 1,
      local: 1,
      pending: 0,
      hedged: 0,
    };
    expect(checkCountsSchema.parse(counts)).toEqual(counts);
    expect(checkCountsSchema.safeParse({ ...counts, holds: -1 }).success).toBe(false);
    expect(checkCountsSchema.safeParse({ ...counts, local: 0.5 }).success).toBe(false);
  });
});
