import { describe, expect, it } from 'vitest';

import { percentile, summarize } from './perf-stats';

describe('perf stats', () => {
  it('reads percentiles off a sorted list and falls back on an empty one', () => {
    expect(percentile([1, 2, 3, 4], 0.5, 9)).toBe(3);
    expect(percentile([1, 2, 3, 4], 0.95, 9)).toBe(4);
    expect(percentile([1, 2, 3, 4], 1, 9)).toBe(4);
    expect(percentile([], 0.5, 9)).toBe(9);
  });

  it('summarises frame intervals', () => {
    expect(summarize([20, 10, 30, 40])).toEqual({
      frames: 4,
      meanMs: 25,
      p50Ms: 30,
      p95Ms: 40,
      fps: 40,
    });
    expect(summarize([])).toEqual({ frames: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, fps: 0 });
  });
});
