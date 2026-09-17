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
import { useStore } from 'zustand';

import { ReplayPanel } from '../components/replay-panel';
import type { BlastRadius, BlobDocument, DivergencePoint, GraphResponse } from '../lib/api';
import { flaresAt } from '../lib/flares';
import { rippleProgress } from '../lib/ripple';
import { EventCards } from './event-cards';
import { FreezeFrame } from './freeze-frame';
import type { ActualCamera } from './graph-canvas';
import { GraphView } from './graph-view';
import { Subtitles } from './subtitles';
import { WorldPanel } from './world-panel';

export interface RunTheatreProps {
  graph: GraphResponse['graph'];
  layout: GraphResponse['layout'];
  keyframes: readonly CameraKeyframe[];
  events: readonly Event[];
  markers: readonly ScrubberMarker[];
  freezeFrame?: DivergencePoint;
  blast?: BlastRadius;
  policyId?: string;
  policyYaml?: string;
  onPose?: (pose: CameraPose, manual: boolean, actual: ActualCamera) => void;
  onClock?: (clock: ReplayClock) => void;
  onFlares?: (flares: ReadonlyMap<string, number>, t: number) => void;
  loadBlob?: (sha256: string) => Promise<BlobDocument>;
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
  freezeFrame,
  blast,
  policyId = 'prod-guard',
  policyYaml,
  onPose,
  onClock,
  onFlares,
  loadBlob,
  height,
}: RunTheatreProps) {
  const replay = useMemo(() => createReplay(events), [events]);
  const [clock] = useState(() => createReplayClock(theatreDuration(replay.duration, keyframes)));
  useEffect(() => {
    onClock?.(clock);
  }, [clock, onClock]);
  const freezeT = freezeFrame === undefined ? undefined : replay.timeOf(freezeFrame.eventId);
  // The world changes the graph attributes to the frozen call: its observed consequences.
  const consequences = useMemo(() => {
    const nodeId = freezeFrame?.nodeId;
    if (nodeId === undefined) return [];
    const ids = new Set(
      graph.edges
        .filter(
          (edge) => edge.from === nodeId && (edge.type === 'mutates' || edge.type === 'observes'),
        )
        .flatMap((edge) => edge.eventIds),
    );
    return events.filter((event) => event.kind === 'world.change' && ids.has(event.id));
  }, [graph, events, freezeFrame]);
  useEffect(() => {
    clock.getState().setStop(freezeT);
  }, [clock, freezeT]);
  const t = useStore(clock, (state) => state.t);
  const flares = useMemo(() => flaresAt(replay, t), [replay, t]);
  // ARCHITECTURE §11: the ripple leaves the frozen action and crosses the blast one wave at a time.
  const progress = rippleProgress(t, freezeT, blast?.waves.length ?? 0);
  useEffect(() => {
    onFlares?.(flares, t);
  }, [flares, t, onFlares]);
  return (
    <div className="flex flex-col gap-6" data-testid="run-theatre">
      <div className="relative grid gap-4 md:grid-cols-[minmax(0,1fr)_20rem]">
        <FreezeFrame
          clock={clock}
          replay={replay}
          freezeFrame={freezeFrame}
          policyId={policyId}
          policyYaml={policyYaml}
          consequences={consequences}
        />
        <GraphView
          graph={graph}
          layout={layout}
          events={events}
          clock={clock}
          keyframes={keyframes}
          onPose={onPose}
          flares={flares}
          blast={blast}
          progress={progress}
          height={height}
        >
          <Subtitles clock={clock} replay={replay} />
        </GraphView>
        <div style={{ height }} className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
          <WorldPanel clock={clock} replay={replay} />
          <EventCards clock={clock} replay={replay} loadBlob={loadBlob} />
        </div>
      </div>
      <ReplayPanel events={events} markers={markers} clock={clock} replay={replay} />
    </div>
  );
}
