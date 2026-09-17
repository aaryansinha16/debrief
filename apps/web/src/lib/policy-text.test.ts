import { PROD_GUARD_YAML } from '@debrief/policy';
import { describe, expect, it } from 'vitest';

import { ruleBlock } from './policy-text';

describe('ruleBlock', () => {
  it('extracts one rule from the sample policy', () => {
    const block = ruleBlock(PROD_GUARD_YAML, 'prod-destructive-needs-approval')!;
    expect(block.split('\n')[0]).toContain('- id: prod-destructive-needs-approval');
    expect(block).toContain('target.environment: production');
    expect(block).toContain('effect: require_approval');
    expect(block).not.toContain('token-scope-mismatch');
    const last = ruleBlock(PROD_GUARD_YAML, 'unknown-environment-destructive')!;
    expect(last).toContain('target.environment: unknown');
    expect(last.endsWith('effect: require_approval')).toBe(true);
    expect(ruleBlock(PROD_GUARD_YAML, 'nope')).toBeUndefined();
    expect(ruleBlock('rules:\n  - id: x\n', 'x')).toBe('  - id: x');
    expect(ruleBlock('- id\n', 'x')).toBeUndefined();
    expect(ruleBlock('version: 1\nrules:\n  - id: x\n    effect: deny\nnext: 1\n', 'x')).toBe(
      '  - id: x\n    effect: deny',
    );
  });
});
