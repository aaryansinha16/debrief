import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ApiError, createApiClient } from '../../../../lib/api';
import { readEnv } from '../../../../lib/env';
import { SealedFile } from '../../../../scenes/sealed-file';

export const dynamic = 'force-dynamic';

export default async function EvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const api = createApiClient();
  let run;
  try {
    run = await api.getRun(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="mb-2 font-mono text-xl">{run.id} · sealed file</h1>
        <p className="text-sm text-text-muted">
          {run.agentName} for <span className="font-mono">{run.principalId}</span> ·{' '}
          {run.eventCount} events ·{' '}
          <Link href={`/runs/${encodeURIComponent(run.id)}`} className="text-cyan hover:underline">
            back to the theatre
          </Link>
        </p>
      </div>
      <SealedFile runId={run.id} verifyUrl={readEnv().VERIFY_URL} />
    </section>
  );
}
