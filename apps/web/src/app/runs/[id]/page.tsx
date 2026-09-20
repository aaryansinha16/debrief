import { SAMPLE_POLICIES } from '@debrief/policy';
import { notFound } from 'next/navigation';

import { RunHeader } from '../../../components/run-header';
import { Theatre } from '../../../scenes/theatre';
import { ApiError, createApiClient } from '../../../lib/api';

export const dynamic = 'force-dynamic';

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { event } = await searchParams;
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
  const blast =
    divergence.freezeFrame?.nodeId === undefined
      ? undefined
      : await api.getBlast(id, divergence.freezeFrame.nodeId);
  return (
    <section className="flex flex-col gap-6">
      <RunHeader run={run} view="theatre" divergences={divergence.points.length} />
      <Theatre
        graph={graphResponse.graph}
        events={events}
        divergence={divergence}
        blast={blast}
        policyId="prod-guard"
        policyYaml={SAMPLE_POLICIES['prod-guard']}
        initialEventId={typeof event === 'string' ? event : undefined}
      />
    </section>
  );
}
