'use client';

import type { Event } from '@debrief/schema';
import { useEffect, useState } from 'react';

import type { BlastRadius, GraphResponse } from '../lib/api';
import { rippleProgress } from '../lib/ripple';
import { AffectedList } from './affected-list';
import type { RenderStats } from './graph-canvas';
import { GraphView } from './graph-view';

export interface BlastViewProps {
  graph: GraphResponse['graph'];
  layout: GraphResponse['layout'];
  events: readonly Event[];
  blast: BlastRadius;
  height?: number;
  onRender?: (stats: RenderStats) => void;
  onProgress?: (progress: number) => void;
}

// The ripple plays once on arrival and again on request; the frame loop stays on demand, each step invalidates one frame.
// performance.now() is read in place: a clock passed as a default parameter is inlined by the minifier and would restart the effect.
export function useRippleRun(hops: number, run: number): number {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const started = performance.now();
    let frame = 0;
    const step = (): void => {
      const next = rippleProgress(performance.now(), started, hops);
      setProgress(next);
      if (next < hops + 1) frame = requestAnimationFrame(step);
    };
    setProgress(0);
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [hops, run]);
  return progress;
}

export function waveText(progress: number, hops: number): string {
  if (progress > hops) return `${String(hops)} wave${hops === 1 ? '' : 's'} · settled`;
  if (progress < 1)
    return `leaving the origin · ${String(hops)} wave${hops === 1 ? '' : 's'} ahead`;
  return `wave ${String(Math.floor(progress))} of ${String(hops)}`;
}

export function BlastView({
  graph,
  layout,
  events,
  blast,
  height = 520,
  onRender,
  onProgress,
}: BlastViewProps) {
  const hops = blast.waves.length;
  const [run, setRun] = useState(0);
  const progress = useRippleRun(hops, run);
  useEffect(() => {
    onProgress?.(progress);
  }, [progress, onProgress]);
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_20rem]" data-testid="blast-view">
      <GraphView
        graph={graph}
        layout={layout}
        events={events}
        blast={blast}
        progress={progress}
        height={height}
        onRender={onRender}
      >
        <div
          className="pointer-events-none absolute top-4 left-4 flex items-center gap-3 font-mono text-xs text-text-muted"
          data-testid="ripple-status"
        >
          <span data-testid="ripple-wave">{waveText(progress, hops)}</span>
          <button
            type="button"
            className="pointer-events-auto rounded border border-stage-edge px-2 py-1 text-text-muted hover:bg-stage-raised"
            onClick={() => {
              setRun((count) => count + 1);
            }}
            data-testid="ripple-replay"
          >
            ripple again
          </button>
        </div>
      </GraphView>
      <div style={{ height }} className="min-h-0 overflow-y-auto pr-1">
        <AffectedList blast={blast} graph={graph} progress={progress} />
      </div>
    </div>
  );
}
