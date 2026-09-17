import { ulidSchema } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import { ulid } from './ulid.js';

describe('ulid', () => {
  it('produces valid, time-ordered, distinct ulids', () => {
    const a = ulid(1_000);
    const b = ulid(2_000);
    expect(ulidSchema.safeParse(a).success).toBe(true);
    expect(a.slice(0, 10)).toBe('00000000Z8');
    expect(a < b).toBe(true);
    expect(new Set(Array.from({ length: 1000 }, () => ulid())).size).toBe(1000);
    expect(ulid(281_474_976_710_655).slice(0, 10)).toBe('7ZZZZZZZZZ');
  });
});
