import { claimAttrsSchema } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import { PREDICATES, isCheckedPredicate, predicateParams } from './catalogue.js';

describe('catalogue', () => {
  it('names only predicates the claim schema accepts', () => {
    for (const predicate of [...Object.keys(PREDICATES), 'unchecked']) {
      const attrs = {
        'claim.text': 'x',
        'claim.span.message_id': 'm1',
        'claim.span.start': 0,
        'claim.span.end': 1,
        'claim.modality': 'asserted',
        'claim.predicate': predicate,
      };
      expect(claimAttrsSchema.safeParse(attrs).success, predicate).toBe(true);
    }
    expect(isCheckedPredicate('tests.passed')).toBe(true);
    expect(isCheckedPredicate('unchecked')).toBe(false);
    expect(isCheckedPredicate('constructor')).toBe(false);
  });

  it('keeps known params it can read and drops the rest', () => {
    expect(
      predicateParams('tests.passed', [
        { name: 'passed', value: '142' },
        { name: 'failed', value: 'none' },
        { name: 'flaky', value: '2' },
        { name: 'passed', value: '7' },
      ]),
    ).toEqual({ passed: 142 });
    expect(predicateParams('db.scope', [{ name: 'environment', value: 'staging' }])).toEqual({
      environment: 'staging',
    });
    expect(predicateParams('db.scope', [{ name: 'environment', value: 'qa' }])).toEqual({});
    expect(predicateParams('unchecked', [{ name: 'x', value: '1' }])).toEqual({});
  });
});
