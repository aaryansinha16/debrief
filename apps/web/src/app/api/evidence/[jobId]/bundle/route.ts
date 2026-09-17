import { createApiClient } from '../../../../../lib/api';
import { failure } from '../../../../../lib/proxy';

export const dynamic = 'force-dynamic';

// The bytes the page verifies in the browser before it offers the download; never cached.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const { jobId } = await params;
  try {
    const bytes = await createApiClient().getEvidenceBundle(jobId);
    return new Response(new Blob([bytes as BlobPart]), {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="debrief-evidence-${jobId}.zip"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    return failure(error);
  }
}
