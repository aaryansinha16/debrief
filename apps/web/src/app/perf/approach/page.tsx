import { ApproachProbe } from '../../../scenes/approach-probe';

export const dynamic = 'force-dynamic';

export default async function PerfApproachPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const agents = typeof params.agents === 'string' ? Number(params.agents) : undefined;
  const seconds = typeof params.seconds === 'string' ? Number(params.seconds) : undefined;
  return (
    <ApproachProbe
      agents={
        agents !== undefined && Number.isInteger(agents) && agents >= 0
          ? Math.min(agents, 10_000)
          : undefined
      }
      seconds={seconds !== undefined && seconds > 0 ? seconds : undefined}
    />
  );
}
