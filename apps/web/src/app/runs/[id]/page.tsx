import { notFound } from 'next/navigation';

import { ApiError, createApiClient } from '../../../lib/api';
import { formatDuration, formatTime } from '../../../lib/format';

export const dynamic = 'force-dynamic';

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let run;
  try {
    run = await createApiClient().getRun(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  return (
    <section>
      <h1 className="mb-2 font-mono text-xl">{run.id}</h1>
      <p className="mb-6 text-sm text-text-muted">
        {run.agentName} for <span className="font-mono">{run.principalId}</span> ·{' '}
        {formatTime(run.startedAt)} · {formatDuration(run.startedAt, run.endedAt)} ·{' '}
        {run.eventCount} events
      </p>
      <p className="text-text-muted">The Theatre opens at P-33.</p>
    </section>
  );
}
