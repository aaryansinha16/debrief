import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError, ApiNotConfiguredError, createApiClient } from '../../../lib/api';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  includeContent: z.boolean().optional(),
  policyId: z.string().min(1).optional(),
});

// Queues the evidence job for a run with the server-side key; the browser polls the job by id.
export async function POST(request: Request): Promise<Response> {
  const run = new URL(request.url).searchParams.get('run');
  if (run === null || run === '') {
    return NextResponse.json({ message: 'run is required' }, { status: 400 });
  }
  let body: unknown;
  try {
    const text = await request.text();
    body = text === '' ? {} : JSON.parse(text);
  } catch {
    return NextResponse.json({ message: 'body must be json' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'body is { includeContent?: boolean, policyId?: string }' },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await createApiClient().createEvidenceJob(run, parsed.data), {
      status: 202,
    });
  } catch (error) {
    return failure(error);
  }
}

export function failure(error: unknown): Response {
  if (error instanceof ApiNotConfiguredError) {
    return NextResponse.json({ message: error.message }, { status: 503 });
  }
  if (error instanceof ApiError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  throw error;
}
