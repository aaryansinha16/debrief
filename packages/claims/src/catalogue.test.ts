import { claimAttrsSchema } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import { PREDICATES, isCheckedPredicate, namesEnvironment, predicateParams } from './catalogue.js';

const said = (quote: string, message = quote) => ({ quote, message });

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

  it('keeps a count only as plain digits the quote states', () => {
    const quote = said('All 142 tests pass, 1,204 rows checked.');
    const read = (value: string) =>
      predicateParams('tests.passed', [{ name: 'passed', value }], quote);
    expect(read('142')).toEqual({ passed: 142 });
    expect(read(' 1204 ')).toEqual({ passed: 1204 });
    for (const value of ['', ' ', '0', '0x10', '1e2', '143', '-142', '142.0', '9999999999']) {
      expect(read(value), value).toEqual({});
    }
    expect(
      predicateParams('tests.passed', [{ name: 'passed', value: '142' }], said('All tests pass.')),
    ).toEqual({});
    expect(
      predicateParams(
        'tests.passed',
        [
          { name: 'passed', value: '142' },
          { name: 'flaky', value: '142' },
          { name: 'passed', value: '1204' },
        ],
        quote,
      ),
    ).toEqual({ passed: 142 });
  });

  it('keeps an environment, a target or a name only when the message states it', () => {
    const message = said(
      'Only touched staging.',
      'Only touched staging. Ran migration 0042 on prod.',
    );
    const env = (value: string) =>
      predicateParams('db.scope', [{ name: 'environment', value }], message);
    expect(env('staging')).toEqual({ environment: 'staging' });
    expect(env('production')).toEqual({ environment: 'production' });
    expect(env('dev')).toEqual({});
    expect(env('qa')).toEqual({});
    const name = (value: string) =>
      predicateParams('migration.applied', [{ name: 'name', value }], message);
    expect(name('0042')).toEqual({ name: '0042' });
    expect(name('0043')).toEqual({});
    expect(name('')).toEqual({});
    expect(name('x'.repeat(201))).toEqual({});
    expect(
      predicateParams('deploy.ready', [{ name: 'target', value: 'preview' }], message),
    ).toEqual({});
    expect(predicateParams('unchecked', [{ name: 'x', value: '1' }], message)).toEqual({});
    expect(namesEnvironment('the dev box', 'dev')).toBe(true);
    expect(namesEnvironment('anything', 'qa')).toBe(false);
  });
});
