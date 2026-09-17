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
import type { ActualCamera, RenderStats } from './graph-canvas';
import { RunTheatre } from './run-theatre';

export interface TheatreHandle {
  keyframes: CameraKeyframe[];
  pose?: CameraPose;
  actual?: ActualCamera;
  manual: boolean;
  frames: number;
  deletionT?: number;
  flares?: { ids: string[]; t: number };
  drawCalls?: number;
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
    const deletion = events.find(
      (event) => event.kind === 'world.change' && event.target?.operation === 'deleteVolume',
    );
    const deletionT = deletion === undefined ? undefined : replay.timeOf(deletion.id);
    return { events, graph, layout, keyframes, markers, deletionT, report, blast };
  }, []);
  const frames = useRef(0);
  const drawCalls = useRef(0);
  const onRender = useCallback((stats: RenderStats): void => {
    if (stats.calls <= drawCalls.current) return;
    drawCalls.current = stats.calls;
    window.__theatre = {
      keyframes: [],
      manual: false,
      frames: 0,
      ...window.__theatre,
      drawCalls: stats.calls,
    };
  }, []);
  const onClock = useCallback((clock: ReplayClock): void => {
    window.__theatreSeek = (t: number) => {
      clock.getState().pause();
      clock.getState().seek(t);
    };
  }, []);
  const onPose = (pose: CameraPose, manual: boolean, actual: ActualCamera): void => {
    frames.current += 1;
    window.__theatre = {
      ...window.__theatre,
      keyframes: data.keyframes,
      pose,
      actual,
      manual,
      frames: frames.current,
      ...(data.deletionT === undefined ? {} : { deletionT: data.deletionT }),
    };
  };
  const onFlares = useCallback((flares: ReadonlyMap<string, number>, t: number): void => {
    window.__theatre = {
      keyframes: [],
      manual: false,
      frames: 0,
      ...window.__theatre,
      flares: { ids: [...flares.keys()], t },
    };
  }, []);
  return (
    <div data-testid="theatre-probe">
      <RunTheatre
        graph={data.graph}
        layout={data.layout}
        keyframes={data.keyframes}
        events={data.events}
        markers={data.markers}
        freezeFrame={data.report.freezeFrame}
        blast={data.blast}
        policyId="prod-guard"
        policyYaml={PROD_GUARD_YAML}
        onPose={onPose}
        onClock={onClock}
        onFlares={onFlares}
        onRender={onRender}
        height={480}
      />
    </div>
  );
}
