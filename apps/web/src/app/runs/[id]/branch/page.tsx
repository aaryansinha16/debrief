import { SAMPLE_POLICIES } from '@debrief/policy';
import { createReplay } from '@debrief/ui';
import { notFound } from 'next/navigation';

import { RunHeader } from '../../../../components/run-header';

import { ApiError, createApiClient } from '../../../../lib/api';
import { markersFor } from '../../../../lib/markers';
import { BranchView } from '../../../../scenes/branch-view';

export const dynamic = 'force-dynamic';

export default async function BranchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const api = createApiClient();
  let run;
  try {
    run = await api.getRun(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const yaml = SAMPLE_POLICIES['prod-guard'] ?? '';
  const [events, graphResponse, initialBranch] = await Promise.all([
    api.listEvents(id),
    api.getGraph(id),
    api.postCounterfactual(id, { policy: yaml }),
  ]);
  const inRun = events.filter((event) => event.runId === id);
  const replay = createReplay(inRun);
  const markers = markersFor(graphResponse.divergence, (eventId) => replay.timeOf(eventId));
  return (
    <section className="flex flex-col gap-6">
      <RunHeader
        run={run}
        view="branch"
        divergences={graphResponse.divergence.points.length}
        detail="edit the policy on the left; the second timeline shows where this run would have halted under it"
      />
      <BranchView
        runId={run.id}
        events={inRun}
        recordedMarkers={markers}
        initialYaml={yaml}
        initialBranch={initialBranch}
      />
    </section>
  );
}
