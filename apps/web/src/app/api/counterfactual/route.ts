import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError, ApiNotConfiguredError, createApiClient } from '../../../lib/api';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ policy: z.string().min(1).max(64_000) });

// ARCHITECTURE §11 Branch: the editor's YAML goes to POST counterfactual with the server-side key; the browser sees the branch, never the key.
export async function POST(request: Request): Promise<Response> {
  const run = new URL(request.url).searchParams.get('run');
  if (run === null || run === '') {
    return NextResponse.json({ message: 'run is required' }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'body must be json' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: 'body is { policy: <yaml> }' }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await createApiClient().postCounterfactual(run, { policy: parsed.data.policy }),
    );
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
