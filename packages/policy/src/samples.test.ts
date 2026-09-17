import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parsePolicy } from './parse.js';
import { ALLOW_ALL } from './policy.js';
import { ALLOW_ALL_YAML, PROD_GUARD_YAML, SAMPLE_POLICIES } from './samples.js';

describe('sample policies', () => {
  it('match the YAML fixture and the allow-all constant', () => {
    const fixture = readFileSync(
      new URL('./__fixtures__/prod-guard.yaml', import.meta.url),
      'utf8',
    );
    expect(parsePolicy(PROD_GUARD_YAML)).toEqual(parsePolicy(fixture));
    expect(parsePolicy(ALLOW_ALL_YAML)).toEqual(ALLOW_ALL);
    expect(Object.keys(SAMPLE_POLICIES)).toEqual(['allow-all', 'prod-guard']);
  });
});
