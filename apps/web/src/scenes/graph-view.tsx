'use client';

import type { Event } from '@debrief/schema';
import type { CameraKeyframe, CameraPose, ReplayClock } from '@debrief/ui';

import type { ActualCamera, RenderStats } from './graph-canvas';
import dynamic from 'next/dynamic';
import { type ReactNode, useMemo, useState } from 'react';

import type { BlastRadius, GraphResponse } from '../lib/api';
import { rippleOf } from '../lib/ripple';
import { LOD_NODE_THRESHOLD, buildSceneData } from '../lib/scene';
import { GraphHoverCard, ProvenanceLegend } from './graph-hover-card';

const GraphCanvas = dynamic(() => import('./graph-canvas').then((m) => m.GraphCanvas), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-text-muted">
      loading the stage…
    </div>
  ),
});

export interface GraphViewProps {
  graph: GraphResponse['graph'];
  layout: GraphResponse['layout'];
  events: readonly Event[];
  height?: number;
  clock?: ReplayClock;
  keyframes?: readonly CameraKeyframe[];
  onPose?: (pose: CameraPose, manual: boolean, actual: ActualCamera) => void;
  flares?: ReadonlyMap<string, number>;
  blast?: BlastRadius;
  progress?: number;
  onRender?: (stats: RenderStats) => void;
  children?: ReactNode;
}

export function GraphView({
  graph,
  layout,
  events,
  height = 520,
  clock,
  keyframes,
  onPose,
  flares,
  blast,
  progress,
  onRender,
  children,
}: GraphViewProps) {
  const scene = useMemo(() => buildSceneData(graph, layout, events), [graph, layout, events]);
  const [hovered, setHovered] = useState<number | undefined>(undefined);
  const node = hovered === undefined ? undefined : scene.nodes[hovered];
  const indexById = useMemo(
    () => new Map(scene.nodes.map((entry) => [entry.id, entry.index])),
    [scene],
  );
  const ripple = useMemo(
    () => (blast === undefined ? undefined : rippleOf(blast, scene)),
    [blast, scene],
  );
  const flareIndices = useMemo(() => {
    const map = new Map<number, number>();
    for (const [id, strength] of flares ?? []) {
      const index = indexById.get(id);
      if (index !== undefined) map.set(index, strength);
    }
    return map;
  }, [flares, indexById]);
  return (
    <div
      className="relative w-full overflow-hidden rounded border border-stage-edge"
      style={{ height }}
      data-testid="graph-view"
    >
      <GraphCanvas
        scene={scene}
        hovered={hovered}
        onHover={setHovered}
        clock={clock}
        keyframes={keyframes}
        onPose={onPose}
        flares={flareIndices}
        ripple={ripple}
        progress={progress}
        onRender={onRender}
      />
      {node === undefined ? null : <GraphHoverCard node={node} eventCount={node.eventIds.length} />}
      {children}
      <ProvenanceLegend />
      <p
        className="pointer-events-none absolute bottom-4 left-4 font-mono text-xs text-text-muted"
        data-testid="graph-stats"
      >
        {scene.nodes.length} nodes · {scene.edges.length} edges
        {scene.nodes.length > LOD_NODE_THRESHOLD ? ' · edges shown around the hovered node' : ''}
      </p>
    </div>
  );
}
