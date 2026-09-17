import type { Authority, EventInput, Risk, Target } from '@debrief/schema';

export type WorldChange = Omit<EventInput, 'id' | 'ts' | 'tenantId'> & { sourceId: string };

export interface WorldHookOptions {
  apiUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  log?: (message: string) => void;
}

export interface ChangeInput {
  traceparent?: string;
  authority: Authority;
  target: Target & {
    environment: 'production' | 'staging';
    resource: string;
    operation: string;
    risk: Risk;
  };
  field: string;
  before: string | number | boolean;
  after: string | number | boolean;
  extra?: Record<string, string | number | boolean>;
  summary: string;
}

const traceIdOf = (traceparent: string | undefined): string | undefined => {
  const match = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/.exec(traceparent ?? '');
  return match?.[1];
};

// Observed provenance: the world reports its own change, never the agent (ARCHITECTURE §8).
export class WorldHook {
  private seq = 0;
  readonly emitted: WorldChange[] = [];
  private inflight: Promise<void> = Promise.resolve();

  constructor(private readonly options: WorldHookOptions | undefined) {}

  record(change: ChangeInput): WorldChange {
    this.seq += 1;
    const traceId = traceIdOf(change.traceparent);
    const attrs: Record<string, string | number | boolean> = {
      'world.project': change.target.resource.split('/')[1] ?? '',
      'world.environment': change.target.environment,
      'world.resource': change.target.resource,
      'world.operation': change.target.operation,
      'world.field': change.field,
      'world.before': change.before,
      'world.after': change.after,
      ...change.extra,
    };
    if (change.traceparent !== undefined && traceId !== undefined)
      attrs.traceparent = change.traceparent;
    const event: WorldChange = {
      sourceId: `orbital:change:${String(this.seq)}`,
      sourceTs: new Date().toISOString(),
      source: 'world-hook',
      provenance: 'observed',
      runId: traceId ?? 'orbital:unattributed',
      kind: 'world.change',
      actor: { type: 'system', id: 'orbital-infra', name: 'Orbital infra' },
      authority: change.authority,
      target: change.target,
      attrs,
      summary: change.summary.slice(0, 280),
    };
    this.emitted.push(event);
    this.inflight = this.inflight.then(() => this.send(event));
    return event;
  }

  drain(): Promise<void> {
    return this.inflight;
  }

  private async send(event: WorldChange, attempt = 0): Promise<void> {
    if (this.options === undefined) return;
    const doFetch = this.options.fetch ?? fetch;
    try {
      const response = await doFetch(new URL('/v1/events', this.options.apiUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({ events: [event] }),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return;
      if (response.status < 500 && response.status !== 429) {
        this.options.log?.(
          `orbital: debrief rejected ${event.sourceId} (${String(response.status)})`,
        );
        return;
      }
      throw new Error(`status ${String(response.status)}`);
    } catch (error) {
      if (attempt >= 3) {
        this.options.log?.(`orbital: dropped ${event.sourceId} after retries (${String(error)})`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
      await this.send(event, attempt + 1);
    }
  }
}
