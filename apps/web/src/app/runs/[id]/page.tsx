import { createReplay } from '@debrief/ui';
import { notFound } from 'next/navigation';

import { ReplayPanel } from '../../../components/replay-panel';
import { GraphView } from '../../../scenes/graph-view';
import { ApiError, createApiClient } from '../../../lib/api';
import { formatDuration, formatTime } from '../../../lib/format';
import { markersFor } from '../../../lib/markers';

export const dynamic = 'force-dynamic';

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const api = createApiClient();
  let run;
  try {
    run = await api.getRun(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const [events, graphResponse] = await Promise.all([api.listEvents(id), api.getGraph(id)]);
  const divergence = graphResponse.divergence;
  const replay = createReplay(events);
  const markers = markersFor(divergence, (eventId) => replay.timeOf(eventId));
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="mb-2 font-mono text-xl">{run.id}</h1>
        <p className="text-sm text-text-muted">
          {run.agentName} for <span className="font-mono">{run.principalId}</span> ·{' '}
          {formatTime(run.startedAt)} · {formatDuration(run.startedAt, run.endedAt)} ·{' '}
          {run.eventCount} events · {divergence.points.length} divergence
          {divergence.points.length === 1 ? '' : 's'} under prod-guard
        </p>
      </div>
      <GraphView graph={graphResponse.graph} layout={graphResponse.layout} events={events} />
      <ReplayPanel events={events} markers={markers} />
    </section>
  );
}
