'use client';

import { PROD_GUARD_YAML, parsePolicy } from '@debrief/policy';
import {
  blastRadius,
  direct,
  divergence,
  layout as layoutGraph,
  reconstructGraph,
} from '@debrief/reconstruct';
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import {
  type CameraKeyframe,
  type CameraPose,
  type ReplayClock,
  type ScrubberMarker,
  createReplay,
} from '@debrief/ui';
import { useCallback, useMemo, useRef } from 'react';

import { markersFor } from '../lib/markers';
import { RunTheatre } from './run-theatre';

export interface TheatreHandle {
  keyframes: CameraKeyframe[];
  pose?: CameraPose;
  manual: boolean;
  frames: number;
}

declare global {
  interface Window {
    __theatre?: TheatreHandle;
    __theatreSeek?: (t: number) => void;
  }
}

// The demo run reconstructed in the browser so the camera check needs no API: the clock is the page's own.
export function TheatreProbe() {
  const data = useMemo(() => {
    const events = demoRunFixture();
    const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
    const layout = layoutGraph(graph, DEMO_RUN_ID);
    const report = divergence(events, parsePolicy(PROD_GUARD_YAML), graph);
    const blast =
      report.freezeFrame?.nodeId === undefined
        ? undefined
        : blastRadius(graph, report.freezeFrame.nodeId, events);
    const keyframes = direct(graph, layout, report, blast);
    const replay = createReplay(events);
    const markers: ScrubberMarker[] = markersFor(
      {
        runId: DEMO_RUN_ID,
        evaluated: report.evaluated,
        points: report.points,
        ...(report.freezeFrame === undefined ? {} : { freezeFrame: report.freezeFrame }),
      },
      (eventId) => replay.timeOf(eventId),
    );
    return { events, graph, layout, keyframes, markers };
  }, []);
  const frames = useRef(0);
  const onClock = useCallback((clock: ReplayClock): void => {
    window.__theatreSeek = (t: number) => {
      clock.getState().pause();
      clock.getState().seek(t);
    };
  }, []);
  const onPose = (pose: CameraPose, manual: boolean): void => {
    frames.current += 1;
    window.__theatre = { keyframes: data.keyframes, pose, manual, frames: frames.current };
  };
  return (
    <div data-testid="theatre-probe">
      <RunTheatre
        graph={data.graph}
        layout={data.layout}
        keyframes={data.keyframes}
        events={data.events}
        markers={data.markers}
        onPose={onPose}
        onClock={onClock}
        height={480}
      />
    </div>
  );
}
