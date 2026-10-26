import type { WitnessTrust } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import { exceedsTrust } from './trust.js';

describe('exceedsTrust', () => {
  it('ranks local below third-party', () => {
    expect(exceedsTrust('third-party', 'local')).toBe(true);
    expect(exceedsTrust('local', 'third-party')).toBe(false);
    expect(exceedsTrust('local', 'local')).toBe(false);
    expect(exceedsTrust('third-party', 'third-party')).toBe(false);
  });

  it('fails closed on a value it does not know', () => {
    const unknown = 'admin' as WitnessTrust;
    expect(exceedsTrust('local', unknown)).toBe(true);
    expect(exceedsTrust(unknown, 'third-party')).toBe(true);
  });
});
