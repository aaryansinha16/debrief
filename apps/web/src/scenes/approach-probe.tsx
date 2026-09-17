'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createApproachStore } from '../lib/approach';
import { createSimulation } from '../lib/approach-sim';
import { type FrameSummary, percentile, summarize } from '../lib/perf-stats';
import { ApproachView } from './approach-view';
import { rendererName } from './perf-probe';
import type { RenderStats } from './render-meter';

export interface ApproachPerf extends FrameSummary {
  agents: number;
  drawCalls: number;
  renderP50Ms: number;
  renderP95Ms: number;
  pulses: number;
  pulseMaxMs: number;
  pulseP95Ms: number;
  renderer: string;
  done: boolean;
}

declare global {
  interface Window {
    __approach?: ApproachPerf;
  }
}

export interface ApproachProbeProps {
  agents?: number;
  seconds?: number;
}

const TICK_MS = 100;

// The approach on a simulated fleet with the frame loop always on: frame cadence, draw calls and the time from a
// critical event reaching the store to the first frame drawn after it land on window.__approach.
export function ApproachProbe({ agents = 5000, seconds = 4 }: ApproachProbeProps) {
  const store = useMemo(() => {
    const created = createApproachStore('probe');
    created.getState().setConnection('simulated');
    return created;
  }, []);
  const simulation = useMemo(() => createSimulation(agents, 'probe'), [agents]);
  const samples = useRef<number[]>([]);
  const renders = useRef<number[]>([]);
  const latencies = useRef<number[]>([]);
  const drawCalls = useRef(0);
  const seenPulse = useRef<number | undefined>(undefined);
  const started = useRef<number | undefined>(undefined);
  const [result, setResult] = useState<ApproachPerf | undefined>(undefined);
  useEffect(() => {
    store.getState().seedRuns(simulation.runs);
    const timer = setInterval(() => {
      const now = performance.now();
      store.getState().ingest(simulation.tick(now), now);
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [store, simulation]);
  const onRender = useCallback(
    (stats: RenderStats): void => {
      drawCalls.current = Math.max(drawCalls.current, stats.calls);
      const pulse = store.getState().lastPulse;
      if (pulse !== undefined && pulse.at !== seenPulse.current) {
        seenPulse.current = pulse.at;
        latencies.current.push(performance.now() - pulse.at);
      }
      if (started.current !== undefined && performance.now() - started.current >= 500) {
        renders.current.push(stats.ms);
      }
    },
    [store],
  );
  const onFrame = (ms: number): void => {
    if (result !== undefined) return;
    const now = performance.now();
    started.current ??= now;
    if (now - started.current < 500) return;
    samples.current.push(ms);
    if (now - started.current < seconds * 1000 + 500) return;
    const rendered = [...renders.current].sort((a, b) => a - b);
    const waits = [...latencies.current].sort((a, b) => a - b);
    const summary: ApproachPerf = {
      ...summarize(samples.current),
      agents: store.getState().agents.size,
      drawCalls: drawCalls.current,
      renderP50Ms: percentile(rendered, 0.5, 0),
      renderP95Ms: percentile(rendered, 0.95, 0),
      pulses: waits.length,
      pulseMaxMs: waits.at(-1) ?? 0,
      pulseP95Ms: percentile(waits, 0.95, 0),
      renderer: rendererName(),
      done: true,
    };
    window.__approach = summary;
    setResult(summary);
  };
  return (
    <div className="relative" data-testid="approach-probe">
      <ApproachView
        store={store}
        source="none"
        frameloop="always"
        capacity={Math.max(agents, 1)}
        height={600}
        onRender={onRender}
        onFrame={onFrame}
        navigate={() => undefined}
      />
      <pre
        className="absolute top-2 left-2 font-mono text-xs text-text-muted"
        data-testid="approach-result"
      >
        {result === undefined ? `measuring ${String(agents)} agents…` : JSON.stringify(result)}
      </pre>
    </div>
  );
}
