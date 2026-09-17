import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Notice } from '../../../../components/notice';
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
    <div>
      <h1 className="mb-2 font-mono text-xl">{run.id} · blast radius</h1>
      <p className="text-sm text-text-muted">
        {origin === undefined ? 'no origin' : <span className="font-mono">{origin}</span>} ·{' '}
        <Link href={`/runs/${encodeURIComponent(run.id)}`} className="text-cyan hover:underline">
          back to the theatre
        </Link>
      </p>
    </div>
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
