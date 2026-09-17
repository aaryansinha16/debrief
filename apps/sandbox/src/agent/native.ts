import type { Authority } from '@debrief/schema';

export interface NativeEvent {
  sourceId: string;
  sourceTs: string;
  source: 'api';
  provenance: 'reported';
  runId: string;
  kind: 'principal.session' | 'delegation.grant';
  actor: { type: 'human' | 'agent'; id: string; name?: string };
  authority?: Authority;
  attrs: Record<string, string | number | boolean>;
  summary: string;
}

export interface NativeEmitterOptions {
  apiUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

// Session and delegation events the agent knows about itself; sent synchronously to keep the run's order stable.
export async function emitNative(
  options: NativeEmitterOptions,
  events: readonly NativeEvent[],
): Promise<void> {
  const doFetch = options.fetch ?? fetch;
  const response = await doFetch(new URL('/v1/events', options.apiUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
    body: JSON.stringify({ events }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(
      `debrief rejected native events: ${String(response.status)} ${await response.text()}`,
    );
}
