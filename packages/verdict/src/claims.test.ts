import { describe, expect, it } from 'vitest';

import { claim, ev, ist } from './__fixtures__/index.js';
import { claimOf, claimsOf } from './claims.js';

describe('claims', () => {
  const said = claim({
    n: 1,
    at: ist('14:12:18'),
    text: 'All 142 tests pass.',
    predicate: 'tests.passed',
    subject: { system: 'github' },
    params: { passed: 142, workflow: 'ci' },
  });

  it('decodes a claim event into a record with its numeric and string params', () => {
    expect(claimOf({ ...said, attrs: { ...said.attrs, 'claim.param.flag': true } })).toEqual({
      id: said.id,
      seq: 1,
      runId: 'session-fixture',
      saidAt: ist('14:12:18'),
      text: 'All 142 tests pass.',
      modality: 'asserted',
      predicate: 'tests.passed',
      subject: { system: 'github' },
      params: { passed: 142, workflow: 'ci' },
    });
  });

  it('ignores other kinds, a claim without a subject and unreadable claim attrs', () => {
    expect(
      claimOf(ev({ n: 2, at: ist('14:00:00'), kind: 'tool.call', provenance: 'reported' })),
    ).toBeUndefined();
    const { target: _t, ...noTarget } = said;
    expect(claimOf(noTarget)).toBeUndefined();
    expect(claimOf({ ...said, attrs: { ...said.attrs, 'claim.span.end': 3 } })).toBeUndefined();
  });

  it('orders claims by when they were said and takes each id once', () => {
    const later = claim({
      n: 3,
      at: ist('14:13:00'),
      text: 'b',
      predicate: 'unchecked',
      subject: { system: 'x' },
    });
    const twin = claim({
      n: 2,
      at: ist('14:12:18'),
      text: 'a',
      predicate: 'unchecked',
      subject: { system: 'x' },
    });
    expect(claimsOf([later, said, twin, said]).map((c) => c.seq)).toEqual([1, 2, 3]);
  });
});
