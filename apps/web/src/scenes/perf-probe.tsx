'use client';

import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { layout as layoutGraph, reconstructGraph } from '@debrief/reconstruct';
import dynamic from 'next/dynamic';
import { useMemo, useRef, useState } from 'react';

import { buildSceneData, syntheticScene } from '../lib/scene';

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

// Renders the demo graph (or `nodes` synthetic ones) with the frame loop always on and publishes frame timings on window.__perf.
export function PerfProbe({ nodes, seconds = 4, layers = 'all' }: PerfProbeProps) {
  const scene = useMemo(() => {
    if (nodes === undefined) {
      const events = demoRunFixture();
      const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
      return buildSceneData(graph, layoutGraph(graph, 'perf'), events);
    }
    const synthetic = syntheticScene(nodes);
    const graph = layers === 'nodes' ? { ...synthetic.graph, edges: [] } : synthetic.graph;
    const built = buildSceneData(graph, synthetic.layout);
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
  const started = useRef<number | undefined>(undefined);
  const [result, setResult] = useState<PerfResult | undefined>(undefined);
  const onFrame = (ms: number): void => {
    if (result !== undefined) return;
    const now = performance.now();
    started.current ??= now;
    if (now - started.current < 500) return;
    samples.current.push(ms);
    if (now - started.current < seconds * 1000 + 500) return;
    const sorted = [...samples.current].sort((a, b) => a - b);
    const meanMs = sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length);
    const summary: PerfResult = {
      nodes: scene.nodes.length,
      edges: scene.edges.length,
      renderer: rendererName(),
      frames: sorted.length,
      meanMs,
      p50Ms: sorted[Math.floor(sorted.length * 0.5)] ?? meanMs,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? meanMs,
      fps: meanMs === 0 ? 0 : 1000 / meanMs,
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
