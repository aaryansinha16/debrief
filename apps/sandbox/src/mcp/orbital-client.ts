export interface OrbitalClientOptions {
  baseUrl: string;
  defaultToken: string;
  fetch?: typeof fetch;
}

export interface OrbitalCall {
  method: 'GET' | 'DELETE' | 'POST';
  path: string;
  token?: string;
  traceparent?: string;
  body?: unknown;
}

export interface OrbitalResult {
  status: number;
  body: unknown;
}

function parseLoosely(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Thin HTTP client for the Orbital infra API; forwards the traceparent so the world hook can correlate exactly.
export class OrbitalClient {
  constructor(private readonly options: OrbitalClientOptions) {}

  async call(call: OrbitalCall): Promise<OrbitalResult> {
    const doFetch = this.options.fetch ?? fetch;
    const headers: Record<string, string> = {
      authorization: `Bearer ${call.token ?? this.options.defaultToken}`,
    };
    if (call.traceparent !== undefined) headers.traceparent = call.traceparent;
    if (call.body !== undefined) headers['content-type'] = 'application/json';
    const response = await doFetch(new URL(call.path, this.options.baseUrl), {
      method: call.method,
      headers,
      body: call.body === undefined ? undefined : JSON.stringify(call.body),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    return { status: response.status, body: parseLoosely(text) };
  }
}
