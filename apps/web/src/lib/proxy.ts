import { NextResponse } from 'next/server';

import { ApiError, ApiNotConfiguredError } from './api';

// The proxies' shared error mapping: a missing key is 503, an API status passes through, anything else is a bug.
export function failure(error: unknown): Response {
  if (error instanceof ApiNotConfiguredError) {
    return NextResponse.json({ message: error.message }, { status: 503 });
  }
  if (error instanceof ApiError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  throw error;
}
