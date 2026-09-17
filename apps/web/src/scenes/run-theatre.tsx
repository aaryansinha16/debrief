'use client';

import type { Event } from '@debrief/schema';
import {
  type CameraKeyframe,
  type CameraPose,
  type ReplayClock,
  type ScrubberMarker,
  createReplay,
  createReplayClock,
} from '@debrief/ui';
import { useEffect, useMemo, useState } from 'react';

import { ReplayPanel } from '../components/replay-panel';
import type { GraphResponse } from '../lib/api';
import { GraphView } from './graph-view';

export interface RunTheatreProps {
  graph: GraphResponse['graph'];
  layout: GraphResponse['layout'];
  keyframes: readonly CameraKeyframe[];
  events: readonly Event[];
  markers: readonly ScrubberMarker[];
  onPose?: (pose: CameraPose, manual: boolean) => void;
  onClock?: (clock: ReplayClock) => void;
  height?: number;
}

// The film may outlast the events: ripple and pull-back shots follow the last event, so the clock spans both.
export const theatreDuration = (
  replayDuration: number,
  keyframes: readonly CameraKeyframe[],
): number => Math.max(replayDuration, ...keyframes.map((frame) => frame.t * 1000));

// One clock for the stage and the scrubber: the camera follows it, the scrubber scrubs it.
export function RunTheatre({
  graph,
  layout,
  keyframes,
  events,
  markers,
  onPose,
  onClock,
  height,
}: RunTheatreProps) {
  const replay = useMemo(() => createReplay(events), [events]);
  const [clock] = useState(() => createReplayClock(theatreDuration(replay.duration, keyframes)));
  useEffect(() => {
    onClock?.(clock);
  }, [clock, onClock]);
  return (
    <div className="flex flex-col gap-6" data-testid="run-theatre">
      <GraphView
        graph={graph}
        layout={layout}
        events={events}
        clock={clock}
        keyframes={keyframes}
        onPose={onPose}
        height={height}
      />
      <ReplayPanel events={events} markers={markers} clock={clock} replay={replay} />
    </div>
  );
}
