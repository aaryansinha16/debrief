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

export interface SinkOptions {
  apiUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

const endpoint = (options: SinkOptions, path: string): string =>
  `${options.apiUrl.replace(/\/+$/, '')}${path}`;

export type KeyCheck = { ok: true } | { ok: false; fatal: boolean; message: string };

// D-084: the API refuses third-party events from a key that holds less, so the CLI asks first.
export async function checkKey(options: SinkOptions): Promise<KeyCheck> {
  const send = options.fetch ?? fetch;
  const refused = 'a key below third-party will be refused';
  let response: Response;
  try {
    response = await send(endpoint(options, '/v1/me'), {
      headers: { authorization: `Bearer ${options.apiKey}` },
    });
  } catch (error) {
    return {
      ok: false,
      fatal: false,
      message: `could not reach /v1/me (${String(error)}); ${refused}`,
    };
  }
  const status = String(response.status);
  if (response.status === 401 || response.status === 403) {
    return { ok: false, fatal: true, message: `DEBRIEF_API_KEY was refused by /v1/me (${status})` };
  }
  if (!response.ok) {
    return { ok: false, fatal: false, message: `GET /v1/me failed with ${status}; ${refused}` };
  }
  // A web app answering at the API url returns HTML, not the key's trust.
  const body = (await response.json().catch(() => undefined)) as { trust?: unknown } | undefined;
  const trust = body?.trust;
  if (trust === 'third-party') return { ok: true };
  if (typeof trust !== 'string') {
    return {
      ok: false,
      fatal: false,
      message: `the API did not report the key's trust; ${refused}`,
    };
  }
  return {
    ok: false,
    fatal: true,
    message: `DEBRIEF_API_KEY holds ${trust} trust; GitHub events need a third-party key (D-084)`,
  };
}

export function createSink(options: SinkOptions): Sink {
  const send = options.fetch ?? fetch;
  const url = endpoint(options, '/v1/events');
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
