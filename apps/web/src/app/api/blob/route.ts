import { NextResponse } from 'next/server';

import { ApiError, ApiNotConfiguredError, createApiClient } from '../../../lib/api';

export const dynamic = 'force-dynamic';

const SHA256 = /^[0-9a-f]{64}$/;

// Drill-down only: the page never calls this during playback; the browser gets the redacted document, never the key.
export async function GET(request: Request): Promise<Response> {
  const sha = new URL(request.url).searchParams.get('sha');
  if (sha === null || !SHA256.test(sha)) {
    return NextResponse.json({ message: 'sha is a 64-hex sha256' }, { status: 400 });
  }
  try {
    return NextResponse.json(await createApiClient().getBlob(sha), {
      headers: { 'cache-control': 'private, max-age=31536000, immutable' },
    });
  } catch (error) {
    if (error instanceof ApiNotConfiguredError) {
      return NextResponse.json({ message: error.message }, { status: 503 });
    }
    if (error instanceof ApiError) {
      const message =
        error.status === 410
          ? 'the tenant data key was destroyed; this payload is unrecoverable'
          : error.message;
      return NextResponse.json({ message }, { status: error.status });
    }
    throw error;
  }
}
