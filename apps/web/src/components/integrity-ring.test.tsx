import { describe, expect, it } from 'vitest';

import { arcPath } from './integrity-ring';

describe('arcPath', () => {
  it('starts at the top, runs clockwise and stops short so neighbouring caps never touch', () => {
    expect(arcPath(0, 0.5)).toBe('M 171.98 32.56 A 128 128 0 0 1 171.98 287.44');
    expect(arcPath(0.5, 1)).toBe('M 148.02 287.44 A 128 128 0 0 1 148.02 32.56');
    expect(arcPath(0, 1)).toBe('M 171.98 32.56 A 128 128 0 1 1 148.02 32.56');
  });

  it('keeps a sliver of an arc when a claim gets less room than its caps', () => {
    expect(arcPath(0, 0.01)).toBe('M 162.01 32.02 A 128 128 0 0 1 166.03 32.14');
  });
});
