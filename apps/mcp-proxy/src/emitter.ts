import type { ProxyEvent } from './recorder.js';

export interface EmitterOptions {
  apiUrl: string;
  apiKey: string;
  maxBatch?: number;
  flushMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  log?: (message: string) => void;
}

export interface EmitterStats {
  sent: number;
  failed: number;
  batches: number;
}

// Batches proxy events to POST /v1/events; never blocks the relay, retries with backoff, drops after maxRetries.
export class EventsEmitter {
  private queue: ProxyEvent[] = [];
  private timer: NodeJS.Timeout | undefined;
  private inflight: Promise<void> = Promise.resolve();
  readonly stats: EmitterStats = { sent: 0, failed: 0, batches: 0 };

  constructor(private readonly options: EmitterOptions) {}

  push(events: readonly ProxyEvent[]): void {
    if (events.length === 0) return;
    this.queue.push(...events);
    if (this.queue.length >= (this.options.maxBatch ?? 100)) {
      this.flush();
      return;
    }
    this.timer ??= setTimeout(() => {
      this.flush();
    }, this.options.flushMs ?? 250);
    this.timer.unref();
  }

  flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.options.maxBatch ?? 100);
    this.inflight = this.inflight.then(() => this.send(batch));
    if (this.queue.length > 0) this.flush();
  }

  async drain(): Promise<void> {
    this.flush();
    await this.inflight;
  }

  private async send(batch: ProxyEvent[], attempt = 0): Promise<void> {
    const doFetch = this.options.fetch ?? fetch;
    try {
      const response = await doFetch(new URL('/v1/events', this.options.apiUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({ events: batch }),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        this.stats.sent += batch.length;
        this.stats.batches += 1;
        return;
      }
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        this.stats.failed += batch.length;
        this.options.log?.(
          `debrief: dropped ${String(batch.length)} events (${String(response.status)} ${await response.text()})`,
        );
        return;
      }
      throw new Error(`status ${String(response.status)}`);
    } catch (error) {
      if (attempt >= (this.options.maxRetries ?? 3)) {
        this.stats.failed += batch.length;
        this.options.log?.(
          `debrief: dropped ${String(batch.length)} events after retries (${String(error)})`,
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
      await this.send(batch, attempt + 1);
    }
  }
}
