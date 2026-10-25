import type { GithubWireEvent } from '@debrief/witness-github';

export interface IngestResult {
  accepted: number;
  duplicates: number;
}

export interface Sink {
  post(events: readonly GithubWireEvent[]): Promise<IngestResult>;
}

export class SinkError extends Error {
  constructor(readonly status: number) {
    super(`POST /v1/events failed with ${String(status)}`);
    this.name = 'SinkError';
  }
}

const BATCH = 500;

export function createSink(options: {
  apiUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}): Sink {
  const send = options.fetch ?? fetch;
  const url = `${options.apiUrl.replace(/\/+$/, '')}/v1/events`;
  return {
    async post(events) {
      const total: IngestResult = { accepted: 0, duplicates: 0 };
      for (let start = 0; start < events.length; start += BATCH) {
        const response = await send(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ events: events.slice(start, start + BATCH) }),
        });
        if (!response.ok) throw new SinkError(response.status);
        const body = (await response.json()) as Partial<IngestResult>;
        total.accepted += body.accepted ?? 0;
        total.duplicates += body.duplicates ?? 0;
      }
      return total;
    },
  };
}
