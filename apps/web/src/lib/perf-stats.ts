export interface FrameSummary {
  frames: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  fps: number;
}

export const percentile = (sorted: readonly number[], share: number, fallback: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? fallback;

// Frame intervals summarised the way the smoke judges them: the median is the cadence, p95 the stalls.
export function summarize(samples: readonly number[]): FrameSummary {
  const sorted = [...samples].sort((a, b) => a - b);
  const meanMs = sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length);
  return {
    frames: sorted.length,
    meanMs,
    p50Ms: percentile(sorted, 0.5, meanMs),
    p95Ms: percentile(sorted, 0.95, meanMs),
    fps: meanMs === 0 ? 0 : 1000 / meanMs,
  };
}
