import { notFound } from 'next/navigation';

import { Notice } from '../../../../components/notice';
import { RunHeader } from '../../../../components/run-header';
import { ApiError, createApiClient } from '../../../../lib/api';
import { BlastView } from '../../../../scenes/blast-view';

export const dynamic = 'force-dynamic';

export default async function BlastPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { node } = await searchParams;
  const api = createApiClient();
  let run;
  try {
    run = await api.getRun(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const [events, graphResponse] = await Promise.all([api.listEvents(id), api.getGraph(id)]);
  const origin = typeof node === 'string' ? node : graphResponse.divergence.freezeFrame?.nodeId;
  const header = (
    <RunHeader
      run={run}
      view="blast"
      divergences={graphResponse.divergence.points.length}
      detail={
        origin === undefined ? (
          'no origin'
        ) : (
          <>
            rippling from <span className="font-mono text-text">{origin}</span>
          </>
        )
      }
    />
  );
  if (origin === undefined) {
    return (
      <section className="flex flex-col gap-6">
        {header}
        <Notice title="nothing to ripple from">
          No divergence under prod-guard on this run. Pass{' '}
          <code className="font-mono">?node=&lt;node id&gt;</code> to ripple from any node.
        </Notice>
      </section>
    );
  }
  let blast;
  try {
    blast = await api.getBlast(id, origin);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
      return (
        <section className="flex flex-col gap-6">
          {header}
          <Notice title="unknown node">
            <span className="font-mono">{origin}</span> is not on this run&apos;s graph.
          </Notice>
        </section>
      );
    }
    throw error;
  }
  return (
    <section className="flex flex-col gap-6">
      {header}
      <BlastView
        graph={graphResponse.graph}
        layout={graphResponse.layout}
        events={events}
        blast={blast}
      />
    </section>
  );
}
