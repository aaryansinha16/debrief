import { theatreStageOf } from '../../../lib/theatre-stage';
import { TheatreProbe } from '../../../scenes/theatre-probe';

export const dynamic = 'force-dynamic';

export default async function PerfTheatrePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { stage } = await searchParams;
  return <TheatreProbe stage={theatreStageOf(stage)} />;
}
