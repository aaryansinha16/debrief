import type { Event } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import { SESSION, all, at, ci, claims, deploy, input } from './__fixtures__/mixed-session';
import { type Draft, claimDraft, stored, ulidOf } from './__fixtures__/session-events';
import {
  buildSessionCheck,
  checkCountsSchema,
  claimStateSchema,
  sessionCheckSchema,
} from './session-check';

describe('buildSessionCheck', () => {
  it('puts contradictions first, then third-party holds, local holds, no witness, unchecked, hedged', () => {
    const check = buildSessionCheck(input(all));
    expect(sessionCheckSchema.parse(check)).toEqual(check);
    expect(check.claims.map((claim) => [claim.text, claim.state])).toEqual([
      ['All 9 tests pass.', 'contradicted'],
      ['Deploy is live.', 'holds'],
      ['Migrated staging.', 'holds'],
      ['Removed the flag.', 'holds'],
      ['Rotated the key.', 'no-witness'],
      ['Opened PR #4.', 'pending'],
      ['It should stay green.', 'hedged'],
    ]);
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

  it('joins each verdict to the observed events it cites, with their trust', () => {
    const [broken, , , local, unseen] = buildSessionCheck(input(all)).claims;
    expect(broken?.verdict?.evidence).toEqual([
      expect.objectContaining({ id: ci, summary: 'forge record 3', trust: 'third-party' }),
    ]);
    expect(broken?.params).toEqual({ passed: 9 });
    expect(local?.verdict).toMatchObject({ trust: 'local', checker: 'tests.passed@1' });
    expect(local?.verdict?.evidence[0]?.trust).toBe('local');
    expect(unseen).toMatchObject({ witness: 'missing', verdict: { evidence: [] } });
    expect(broken?.witness).toBe('connected');
  });

  it('never shows an event that is not observed as evidence, nor an old one without trust as third-party', () => {
    const events = input(all).events.map((event): Event => {
      if (event.id === ci) return { ...event, attrs: {} };
      if (event.id === deploy) return { ...event, provenance: 'reported' };
      return event;
    });
    const check = buildSessionCheck({ ...input(all), events });
    const late = check.claims.find((claim) => claim.text === 'Deploy is live.');
    expect(late?.verdict?.evidence).toEqual([]);
    expect(check.claims[0]?.verdict?.evidence[0]?.trust).toBe('local');
  });

  it('keeps a hedged claim and its verdict on the page and out of every count', () => {
    const hedged = buildSessionCheck(input(all)).claims.at(-1);
    expect(hedged).toMatchObject({ modality: 'hedged', state: 'hedged' });
    expect(hedged?.verdict?.outcome).toBe('no-witness');
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

  it('orders claims said at the same moment by id', () => {
    const twin = (n: number): Draft =>
      claimDraft(ulidOf('C', n), SESSION, {
        text: `Claim ${String(n)}.`,
        messageId: `msg-${String(n)}`,
        saidAt: at('10:00:00'),
        predicate: 'unchecked',
        subject: { system: 'forge' },
      });
    const check = buildSessionCheck(input([twin(9), twin(8)]));
    expect(check.claims.map((claim) => claim.text)).toEqual(['Claim 8.', 'Claim 9.']);
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
