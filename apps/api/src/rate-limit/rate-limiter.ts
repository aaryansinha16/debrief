export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

// ingest: trace and event batches · read: everything a viewer does · expensive: jobs, narration and key management.
export type RateBucket = 'ingest' | 'read' | 'expensive';

export type RateLimits = Readonly<Record<RateBucket, number>>;

interface Window {
  startedAt: number;
  count: number;
}

// Fixed window per key and bucket; single-node by design (D-018: no shared state store in v1).
export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limits: RateLimits,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string, bucket: RateBucket = 'read'): RateLimitDecision {
    const limit = this.limits[bucket];
    const at = this.now();
    const id = `${bucket}:${key}`;
    let window = this.windows.get(id);
    if (window === undefined || at - window.startedAt >= this.windowMs) {
      window = { startedAt: at, count: 0 };
      this.windows.set(id, window);
      if (this.windows.size > 10_000) this.sweep(at);
    }
    const resetInMs = window.startedAt + this.windowMs - at;
    if (window.count >= limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(resetInMs / 1000)),
      };
    }
    window.count += 1;
    return { allowed: true, limit, remaining: limit - window.count, retryAfterSeconds: 0 };
  }

  private sweep(at: number): void {
    for (const [key, window] of this.windows) {
      if (at - window.startedAt >= this.windowMs) this.windows.delete(key);
    }
  }
}
