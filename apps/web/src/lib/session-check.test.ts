import type { Event } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import { all, claims, input } from './__fixtures__/mixed-session';
import { stored } from './__fixtures__/session-events';
import {
  buildSessionCheck,
  sessionCheckSchema,
  checkCountsSchema,
  claimStateSchema,
} from './session-check';

describe('buildSessionCheck', () => {
  it('gives every claim a state from its verdict and counts the scored ones', () => {
    const check = buildSessionCheck(input(all));
    expect(sessionCheckSchema.parse(check)).toEqual(check);
    expect(Object.fromEntries(check.claims.map((claim) => [claim.text, claim.state]))).toEqual({
      'All 9 tests pass.': 'contradicted',
      'Deploy is live.': 'holds',
      'Migrated staging.': 'holds',
      'Removed the flag.': 'holds',
      'Rotated the key.': 'no-witness',
      'Opened PR #4.': 'pending',
      'It should stay green.': 'hedged',
    });
    expect(check.counts).toEqual({
      claims: 5,
      holds: 3,
      contradicted: 1,
      noWitness: 1,
      local: 1,
      pending: 1,
      hedged: 1,
    });
  });

  it('takes a claim without a subject to be about an unknown system', () => {
    const events = stored([claims.held]).map((event): Event => {
      const bare = { ...event };
      delete bare.target;
      return bare;
    });
    const [claim] = buildSessionCheck({ ...input([]), events }).claims;
    expect(claim).toMatchObject({
      subject: { system: 'unknown' },
      witness: 'missing',
      history: [],
    });
  });
});

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
