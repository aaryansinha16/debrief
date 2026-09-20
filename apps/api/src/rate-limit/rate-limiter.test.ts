import { describe, expect, it } from 'vitest';

import { RateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  it('allows up to the limit per window, then rejects with a retry-after until the window resets', () => {
    let now = 1_000_000;
    const limiter = new RateLimiter({ ingest: 3, read: 3, expensive: 3 }, 60_000, () => now);
    expect(limiter.check('k')).toEqual({
      allowed: true,
      limit: 3,
      remaining: 2,
      retryAfterSeconds: 0,
    });
    expect(limiter.check('k').remaining).toBe(1);
    expect(limiter.check('k').remaining).toBe(0);
    now += 10_000;
    expect(limiter.check('k')).toEqual({
      allowed: false,
      limit: 3,
      remaining: 0,
      retryAfterSeconds: 50,
    });
    now += 49_500;
    expect(limiter.check('k')).toEqual({
      allowed: false,
      limit: 3,
      remaining: 0,
      retryAfterSeconds: 1,
    });
    now += 500;
    expect(limiter.check('k')).toEqual({
      allowed: true,
      limit: 3,
      remaining: 2,
      retryAfterSeconds: 0,
    });
  });

  it('keeps keys independent and sweeps stale windows', () => {
    let now = 0;
    const limiter = new RateLimiter({ ingest: 1, read: 1, expensive: 2 }, 1_000, () => now);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('b').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
    expect(limiter.check('a', 'expensive')).toMatchObject({
      allowed: true,
      limit: 2,
      remaining: 1,
    });
    expect(limiter.check('a', 'ingest').allowed).toBe(true);
    for (let i = 0; i < 10_001; i += 1) limiter.check(`key-${String(i)}`);
    now += 1_000;
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('fresh').allowed).toBe(true);
  });
});
