import { describe, expect, it } from 'vitest';

import { headlineOf } from './check-copy';
import { type CheckCounts } from './session-check';

const counts = (patch: Partial<CheckCounts>): CheckCounts => {
  const base = {
    holds: 0,
    contradicted: 0,
    noWitness: 0,
    local: 0,
    pending: 0,
    hedged: 0,
    ...patch,
  };
  return { ...base, claims: base.holds + base.contradicted + base.noWitness };
};
const line = (patch: Partial<CheckCounts>): string => {
  const { claims, verdict } = headlineOf(counts(patch));
  return `${claims} ${verdict}`;
};

describe('headlineOf', () => {
  it('says the canvas headline for four holds, two contradicted and one without a witness', () => {
    expect(headlineOf(counts({ holds: 4, contradicted: 2, noWitness: 1 }))).toEqual({
      claims: 'Seven claims.',
      verdict: 'Two fall apart.',
      tone: 'contradicted',
    });
  });

  it('agrees in number, and says all, both or it when every claim went one way', () => {
    expect(line({ holds: 5, contradicted: 1 })).toBe('Six claims. One falls apart.');
    expect(line({ contradicted: 1 })).toBe('One claim. It falls apart.');
    expect(line({ contradicted: 2 })).toBe('Two claims. Both fall apart.');
    expect(line({ contradicted: 13 })).toBe('13 claims. All 13 fall apart.');
    expect(line({ holds: 1 })).toBe('One claim. It holds.');
    expect(line({ holds: 3 })).toBe('Three claims. All three hold.');
    expect(headlineOf(counts({ holds: 3 })).tone).toBe('holds');
  });

  it('never calls a claim no witness saw a hold', () => {
    expect(line({ noWitness: 1 })).toBe('One claim. No witness could check it.');
    expect(line({ noWitness: 4 })).toBe('Four claims. No witness could check them.');
    expect(headlineOf(counts({ noWitness: 4 })).tone).toBe('muted');
    expect(line({ holds: 1, noWitness: 1 })).toBe('Two claims. One holds, one without a witness.');
    expect(line({ holds: 5, noWitness: 2 })).toBe(
      'Seven claims. Five hold, two without a witness.',
    );
  });

  it('agrees with the lead while the verdicts are still to come', () => {
    expect(line({ pending: 1 })).toBe('One claim. None checked yet.');
    expect(line({ pending: 3, hedged: 1 })).toBe('Three claims. None checked yet.');
    expect(headlineOf(counts({ pending: 3 })).tone).toBe('muted');
  });

  it('has nothing to score when the agent claimed nothing or only hedged', () => {
    expect(line({})).toBe('No claims to check. Nothing the agent said can be checked.');
    expect(line({ hedged: 2 })).toBe('No claims to check. Two hedged, never scored.');
    expect(headlineOf(counts({ hedged: 1 })).tone).toBe('muted');
  });
});
