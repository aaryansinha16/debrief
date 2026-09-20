import { notFound } from 'next/navigation';

import { Notice } from '../../../../components/notice';
import { RunHeader } from '../../../../components/run-header';
import { ApiError, createApiClient } from '../../../../lib/api';
import { LineageScene } from '../../../../scenes/lineage-scene';

export const dynamic = 'force-dynamic';

export default async function LineagePage({
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
  const graphResponse = await api.getGraph(id);
  const origin = typeof node === 'string' ? node : graphResponse.divergence.freezeFrame?.nodeId;
  const header = (
    <RunHeader
      run={run}
      view="lineage"
      divergences={graphResponse.divergence.points.length}
      detail={
        origin === undefined ? (
          'no origin'
        ) : (
          <>
            tracing the authority behind <span className="font-mono text-text">{origin}</span>
          </>
        )
      }
    />
  );
  if (origin === undefined) {
    return (
      <section className="flex flex-col gap-6">
        {header}
        <Notice title="nothing to trace">
          No divergence under prod-guard on this run. Pass{' '}
          <code className="font-mono">?node=&lt;node id&gt;</code> to trace any action.
        </Notice>
      </section>
    );
  }
  let lineage;
  try {
    lineage = await api.getLineage(id, origin);
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
      <LineageScene lineage={lineage} runId={run.id} />
    </section>
  );
}
