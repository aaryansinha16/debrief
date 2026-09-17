import { PerfProbe } from '../../../scenes/perf-probe';

export const dynamic = 'force-dynamic';

export default async function PerfGraphPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = typeof params.nodes === 'string' ? Number(params.nodes) : undefined;
  const nodes =
    raw !== undefined && Number.isInteger(raw) && raw > 0 ? Math.min(raw, 50_000) : undefined;
  const seconds = typeof params.seconds === 'string' ? Number(params.seconds) : undefined;
  const layers = params.layers === 'nodes' || params.layers === 'edges' ? params.layers : 'all';
  return (
    <PerfProbe
      nodes={nodes}
      seconds={seconds !== undefined && seconds > 0 ? seconds : undefined}
      layers={layers}
      sync={params.sync === '1'}
    />
  );
}
