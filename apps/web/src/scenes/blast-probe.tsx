'use client';

import { PROD_GUARD_YAML, parsePolicy } from '@debrief/policy';
import {
  blastRadius,
  divergence,
  layout as layoutGraph,
  reconstructGraph,
} from '@debrief/reconstruct';
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { useCallback, useMemo, useRef } from 'react';

import { BlastView } from './blast-view';
import type { RenderStats } from './graph-canvas';

export interface BlastHandle {
  hops: number;
  progress: number;
  drawCalls: number;
  frames: number;
  done: boolean;
}

declare global {
  interface Window {
    __blast?: BlastHandle;
  }
}

// The blast scene on the demo run without an API; draw calls and the ripple's end land on window.__blast for the check.
export function BlastProbe() {
  const data = useMemo(() => {
    const events = demoRunFixture();
    const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
    const layout = layoutGraph(graph, DEMO_RUN_ID);
    const report = divergence(events, parsePolicy(PROD_GUARD_YAML), graph);
    const origin = report.freezeFrame?.nodeId ?? graph.nodes[0]?.id ?? '';
    return { events, graph, layout, blast: blastRadius(graph, origin, events) };
  }, []);
  const stats = useRef({ drawCalls: 0, frames: 0, progress: 0 });
  const publish = useCallback((): void => {
    const { drawCalls, frames, progress } = stats.current;
    const hops = data.blast.waves.length;
    window.__blast = { hops, progress, drawCalls, frames, done: progress >= hops + 1 };
  }, [data]);
  const onRender = useCallback(
    (frame: RenderStats): void => {
      stats.current.drawCalls = Math.max(stats.current.drawCalls, frame.calls);
      stats.current.frames += 1;
      publish();
    },
    [publish],
  );
  const onProgress = useCallback(
    (progress: number): void => {
      stats.current.progress = progress;
      publish();
    },
    [publish],
  );
  return (
    <div data-testid="blast-probe">
      <BlastView
        graph={data.graph}
        layout={data.layout}
        events={data.events}
        blast={data.blast}
        onRender={onRender}
        onProgress={onProgress}
        height={480}
      />
    </div>
  );
}
