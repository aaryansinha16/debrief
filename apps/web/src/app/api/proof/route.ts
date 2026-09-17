import { NextResponse } from 'next/server';

import { ApiError, ApiNotConfiguredError, createApiClient } from '../../../lib/api';

export const dynamic = 'force-dynamic';

// Proxies the inclusion proof with the server-side key so the browser never sees it.
export async function GET(request: Request): Promise<Response> {
  const eventId = new URL(request.url).searchParams.get('event');
  if (eventId === null || eventId === '') {
    return NextResponse.json({ message: 'event is required' }, { status: 400 });
  }
  try {
    return NextResponse.json(await createApiClient().getProof(eventId));
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
