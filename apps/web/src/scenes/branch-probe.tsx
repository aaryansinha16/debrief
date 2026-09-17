'use client';

import { PROD_GUARD_YAML, parsePolicy } from '@debrief/policy';
import { counterfactual, divergence, reconstructGraph } from '@debrief/reconstruct';
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { createReplay } from '@debrief/ui';
import { useCallback, useMemo } from 'react';

import type { Counterfactual } from '../lib/api';
import { markersFor } from '../lib/markers';
import { BranchScene } from './branch-scene';

// The branch scene on the demo run without an API: the counterfactual is computed in the page, so the check measures the editor's own pipeline.
export function BranchProbe() {
  const data = useMemo(() => {
    const events = demoRunFixture();
    const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
    const inRun = events.filter((event) => event.runId === DEMO_RUN_ID);
    const replay = createReplay(inRun);
    const report = divergence(events, parsePolicy(PROD_GUARD_YAML), graph);
    const markers = markersFor(
      {
        runId: DEMO_RUN_ID,
        evaluated: report.evaluated,
        points: report.points,
        ...(report.freezeFrame === undefined ? {} : { freezeFrame: report.freezeFrame }),
      },
      (eventId) => replay.timeOf(eventId),
    );
    const branch = (yaml: string): Counterfactual =>
      counterfactual(events, parsePolicy(yaml), graph);
    return { events, graph, inRun, markers, initial: branch(PROD_GUARD_YAML), branch };
  }, []);
  const branch = useCallback(
    (yaml: string): Promise<Counterfactual> => Promise.resolve(data.branch(yaml)),
    [data],
  );
  return (
    <div data-testid="branch-probe">
      <BranchScene
        runId={DEMO_RUN_ID}
        events={data.inRun}
        recordedMarkers={data.markers}
        initialYaml={PROD_GUARD_YAML}
        initialBranch={data.initial}
        branch={branch}
      />
    </div>
  );
}
