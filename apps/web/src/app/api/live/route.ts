import { NextResponse } from 'next/server';

import {
  ApiError,
  ApiNotConfiguredError,
  type LiveOptions,
  createApiClient,
} from '../../../lib/api';

export const dynamic = 'force-dynamic';

const SEQ = /^-?\d+$/;

// Same-origin SSE for the browser's EventSource: the key stays here, Last-Event-ID is forwarded so a reconnect resumes without gaps.
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const since = params.get('since');
  const run = params.get('run');
  if ((since !== null && !SEQ.test(since)) || run === '') {
    return NextResponse.json({ message: 'since is an integer seq, run a run id' }, { status: 400 });
  }
  const options: LiveOptions = { signal: request.signal };
  if (since !== null) options.since = Number(since);
  if (run !== null) options.run = run;
  const lastEventId = request.headers.get('last-event-id');
  if (lastEventId !== null && SEQ.test(lastEventId)) options.lastEventId = lastEventId;
  try {
    const upstream = await createApiClient().streamLive(options);
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
      },
    });
  } catch (error) {
    if (error instanceof ApiNotConfiguredError) {
      return NextResponse.json({ message: error.message }, { status: 503 });
    }
    if (error instanceof ApiError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
