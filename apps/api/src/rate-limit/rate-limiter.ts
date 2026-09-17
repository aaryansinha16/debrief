export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

interface Window {
  startedAt: number;
  count: number;
}

// Fixed window per key; single-node by design (D-018: no shared state store in v1).
export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): RateLimitDecision {
    const at = this.now();
    let window = this.windows.get(key);
    if (window === undefined || at - window.startedAt >= this.windowMs) {
      window = { startedAt: at, count: 0 };
      this.windows.set(key, window);
      if (this.windows.size > 10_000) this.sweep(at);
    }
    const resetInMs = window.startedAt + this.windowMs - at;
    if (window.count >= this.limit) {
      return {
        allowed: false,
        limit: this.limit,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(resetInMs / 1000)),
      };
    }
    window.count += 1;
    return {
      allowed: true,
      limit: this.limit,
      remaining: this.limit - window.count,
      retryAfterSeconds: 0,
    };
  }

  private sweep(at: number): void {
    for (const [key, window] of this.windows) {
      if (at - window.startedAt >= this.windowMs) this.windows.delete(key);
    }
  }
}
