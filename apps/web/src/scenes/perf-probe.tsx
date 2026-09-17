'use client';

import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { layout as layoutGraph, reconstructGraph } from '@debrief/reconstruct';
import dynamic from 'next/dynamic';
import { useMemo, useRef, useState } from 'react';

import type { Event } from '@debrief/schema';

import type { CausalGraph, Layout } from '../lib/api';
import { buildSceneData, syntheticScene } from '../lib/scene';
import type { RenderStats } from './graph-canvas';

const GraphCanvas = dynamic(() => import('./graph-canvas').then((m) => m.GraphCanvas), {
  ssr: false,
});

export interface PerfResult {
  nodes: number;
  edges: number;
  frames: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  fps: number;
  renderP50Ms: number;
  renderP95Ms: number;
  drawCalls: number;
  synced: boolean;
  renderer: string;
  done: boolean;
}

declare global {
  interface Window {
    __perf?: PerfResult;
  }
}

export interface PerfProbeProps {
  nodes?: number;
  seconds?: number;
  layers?: 'all' | 'nodes' | 'edges';
  sync?: boolean;
}

function demoSource(): { graph: CausalGraph; layout: Layout; events: Event[] } {
  const events = demoRunFixture();
  const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
  return { graph, layout: layoutGraph(graph, 'perf'), events };
}

function rendererName(): string {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (gl === null) return 'none';
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer: unknown =
    info === null ? gl.getParameter(gl.RENDERER) : gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
  return typeof renderer === 'string' ? renderer : 'unknown';
}

const percentile = (sorted: readonly number[], share: number, fallback: number): number =>
  sorted[Math.floor(sorted.length * share)] ?? fallback;

// Renders the demo graph (or `nodes` synthetic ones) with the frame loop always on and publishes frame timings on window.__perf.
// `sync` waits for the raster inside each render call, so the render time is the frame's cost rather than its cadence.
export function PerfProbe({ nodes, seconds = 4, layers = 'all', sync = false }: PerfProbeProps) {
  const scene = useMemo(() => {
    const source: { graph: CausalGraph; layout: Layout; events?: Event[] } =
      nodes === undefined ? demoSource() : syntheticScene(nodes);
    const graph = layers === 'nodes' ? { ...source.graph, edges: [] } : source.graph;
    const built = buildSceneData(graph, source.layout, source.events);
    return layers === 'edges'
      ? {
          ...built,
          positions: new Float32Array(0),
          colors: new Float32Array(0),
          radii: new Float32Array(0),
          nodes: [],
        }
      : built;
  }, [nodes, layers]);
  const samples = useRef<number[]>([]);
  const renders = useRef<number[]>([]);
  const drawCalls = useRef(0);
  const started = useRef<number | undefined>(undefined);
  const [result, setResult] = useState<PerfResult | undefined>(undefined);
  const onRender = (stats: RenderStats): void => {
    drawCalls.current = Math.max(drawCalls.current, stats.calls);
    if (started.current !== undefined && performance.now() - started.current >= 500) {
      renders.current.push(stats.ms);
    }
  };
  const onFrame = (ms: number): void => {
    if (result !== undefined) return;
    const now = performance.now();
    started.current ??= now;
    if (now - started.current < 500) return;
    samples.current.push(ms);
    if (now - started.current < seconds * 1000 + 500) return;
    const sorted = [...samples.current].sort((a, b) => a - b);
    const rendered = [...renders.current].sort((a, b) => a - b);
    const meanMs = sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length);
    const summary: PerfResult = {
      nodes: scene.nodes.length,
      edges: scene.edges.length,
      renderer: rendererName(),
      frames: sorted.length,
      meanMs,
      p50Ms: percentile(sorted, 0.5, meanMs),
      p95Ms: percentile(sorted, 0.95, meanMs),
      fps: meanMs === 0 ? 0 : 1000 / meanMs,
      renderP50Ms: percentile(rendered, 0.5, 0),
      renderP95Ms: percentile(rendered, 0.95, 0),
      drawCalls: drawCalls.current,
      synced: sync,
      done: true,
    };
    window.__perf = summary;
    setResult(summary);
  };
  return (
    <div className="relative h-[600px] w-full" data-testid="perf-probe">
      <GraphCanvas
        scene={scene}
        onHover={() => undefined}
        frameloop="always"
        spin
        onFrame={onFrame}
        onRender={onRender}
        sync={sync}
      />
      <pre
        className="absolute top-2 left-2 font-mono text-xs text-text-muted"
        data-testid="perf-result"
      >
        {result === undefined
          ? `measuring ${String(scene.nodes.length)} nodes…`
          : JSON.stringify(result)}
      </pre>
    </div>
  );
}
