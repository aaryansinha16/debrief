import { NextResponse } from 'next/server';

import { createApiClient } from '../../../../lib/api';
import { failure } from '../route';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const { jobId } = await params;
  try {
    return NextResponse.json(await createApiClient().getEvidenceJob(jobId));
  } catch (error) {
    return failure(error);
  }
}
