'use client';

import type { Event } from '@debrief/schema';
import {
  type Pacing,
  type ReplayClock,
  STORY_PACING,
  createReplay,
  createReplayClock,
} from '@debrief/ui';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';

import { ReplayPanel } from '../components/replay-panel';
import type { BlastRadius, BlobDocument, CausalGraph, Divergence } from '../lib/api';
import { mapFrame, mapLayout } from '../lib/map-layout';
import { markersFor } from '../lib/markers';
import { rippleProgress } from '../lib/ripple';
import { FreezeFrame } from './freeze-frame';
import { MapScene } from './map-scene';
import { Narrative } from './narrative';
import { WorldPanel } from './world-panel';

export interface TheatreProps {
  graph: CausalGraph;
  events: readonly Event[];
  divergence?: Divergence;
  blast?: BlastRadius;
  policyId?: string;
  policyYaml?: string;
  loadBlob?: (sha256: string) => Promise<BlobDocument>;
  initialEventId?: string;
  pacing?: Pacing;
  onClock?: (clock: ReplayClock) => void;
}

// The ripple needs its own beat after the last event before the film ends.
export const TAIL_MS = 2000;

// ARCHITECTURE §11: one clock drives the map, the transcript, the world panel and the scrubber; story time by default.
export function Theatre({
  graph,
  events,
  divergence,
  blast,
  policyId = 'prod-guard',
  policyYaml,
  loadBlob,
  initialEventId,
  pacing = STORY_PACING,
  onClock,
}: TheatreProps) {
  const replay = useMemo(() => createReplay(events, undefined, pacing), [events, pacing]);
  const layout = useMemo(() => mapLayout(graph, events), [graph, events]);
  const order = useMemo(() => replay.events.map((entry) => entry.event.id), [replay]);
  const [clock] = useState(() => createReplayClock(replay.duration + TAIL_MS));
  const freezeFrame = divergence?.freezeFrame;
  useEffect(() => {
    onClock?.(clock);
  }, [clock, onClock]);
  const freezeT = freezeFrame === undefined ? undefined : replay.timeOf(freezeFrame.eventId);
  useEffect(() => {
    clock.getState().setStop(freezeT);
  }, [clock, freezeT]);
  useEffect(() => {
    const at = initialEventId === undefined ? undefined : replay.timeOf(initialEventId);
    if (at !== undefined) clock.getState().seek(at);
  }, [clock, replay, initialEventId]);
  const t = useStore(clock, (state) => state.t);
  const index = replay.indexAt(t);
  const frame = useMemo(() => mapFrame(layout, order, index), [layout, order, index]);
  const current = index === 0 ? undefined : replay.events[index - 1]?.event;
  const diverged = freezeT !== undefined && t >= freezeT;
  const progress = rippleProgress(t, freezeT, blast?.waves.length ?? 0);
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
  const markers = useMemo(
    () =>
      divergence === undefined ? [] : markersFor(divergence, (eventId) => replay.timeOf(eventId)),
    [divergence, replay],
  );
  return (
    <div className="flex flex-col gap-3" data-testid="theatre">
      <div
        className="relative grid gap-3 md:grid-cols-[minmax(0,1fr)_22rem]"
        data-testid="theatre-grid"
      >
        <div className="glass relative overflow-hidden rounded-lg" data-testid="stage">
          <MapScene
            layout={layout}
            frame={frame}
            {...(current === undefined ? {} : { currentEvent: current })}
            {...(freezeFrame?.nodeId === undefined ? {} : { divergenceNodeId: freezeFrame.nodeId })}
            diverged={diverged}
            {...(blast === undefined ? {} : { blast })}
            progress={progress}
            onSelect={(node) => {
              const first = node.eventIds
                .map((id) => replay.timeOf(id))
                .filter((at): at is number => at !== undefined)
                .sort((a, b) => a - b)[0];
              if (first !== undefined) clock.getState().seek(first);
            }}
          />
          <p
            className="flex items-baseline gap-2 border-t border-edge-light px-3 py-2 text-sm"
            data-testid="caption"
            aria-live="polite"
          >
            {current === undefined ? (
              <span className="text-text-muted">before the first event</span>
            ) : (
              <>
                <span className="font-mono text-xs text-text-muted">
                  #{current.seq} {current.kind} ·{' '}
                  <span className={current.provenance === 'observed' ? 'text-ember' : 'text-cyan'}>
                    {current.provenance}
                  </span>
                </span>
                <span className={`truncate ${current.kind === 'llm.call' ? 'italic' : ''}`}>
                  {current.summary ?? ''}
                </span>
              </>
            )}
          </p>
        </div>
        <aside className="relative min-h-[24rem] md:min-h-0" data-testid="side">
          <div className="glass absolute inset-0 flex flex-col gap-3 overflow-hidden rounded-lg p-3">
            <div className="max-h-[38%] shrink-0 overflow-y-auto pr-1">
              <WorldPanel clock={clock} replay={replay} />
            </div>
            <Narrative
              clock={clock}
              replay={replay}
              freezeFrame={freezeFrame}
              {...(loadBlob === undefined ? {} : { loadBlob })}
            />
          </div>
        </aside>
        <FreezeFrame
          clock={clock}
          replay={replay}
          freezeFrame={freezeFrame}
          policyId={policyId}
          policyYaml={policyYaml}
          consequences={consequences}
        />
      </div>
      <ReplayPanel events={events} markers={markers} clock={clock} replay={replay} />
    </div>
  );
}
