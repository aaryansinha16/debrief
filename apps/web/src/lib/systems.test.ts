import { describe, expect, it } from 'vitest';

import { SYSTEM_LABELS, isKnownSystem, systemLabel } from './systems';

describe('systemLabel', () => {
  it('names a known system and falls back to the id for any other', () => {
    expect(systemLabel('tidewater')).toBe('Tidewater');
    expect(systemLabel('git')).toBe('Local git');
    expect(systemLabel('payroll')).toBe('payroll');
    expect(isKnownSystem('toString')).toBe(false);
  });

  it('keeps real vendor names out until D-079 covers web fixtures', () => {
    expect(JSON.stringify(SYSTEM_LABELS)).not.toMatch(/GitHub|Neon|Vercel|Stripe|AWS/i);
  });
});
