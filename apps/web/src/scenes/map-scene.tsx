'use client';

import type { Event } from '@debrief/schema';
import { COLORS } from '@debrief/ui';

import type { BlastRadius } from '../lib/api';
import { type MapFrame, type MapLayout, type MapNode, shortLabel } from '../lib/map-layout';

export interface MapSceneProps {
  layout: MapLayout;
  frame: MapFrame;
  currentEvent?: Event;
  divergenceNodeId?: string;
  diverged: boolean;
  blast?: BlastRadius;
  progress: number;
  onSelect?: (node: MapNode) => void;
}

const EDGE_LIT = '#4a4a5c';

// Hop per map node once the ripple is on: the origin is hop 0, each wave one more.
export function blastHops(layout: MapLayout, blast: BlastRadius | undefined): Map<string, number> {
  const hops = new Map<string, number>();
  if (blast === undefined) return hops;
  const origin = layout.nodeOf(blast.origin);
  if (origin !== undefined) hops.set(origin.id, 0);
  for (const wave of blast.waves) {
    for (const resource of wave.resources) {
      const node = layout.nodeOf(resource.nodeId);
      if (node !== undefined && !hops.has(node.id)) hops.set(node.id, wave.hop);
    }
  }
  return hops;
}

interface Port {
  x: number;
  y: number;
}

// Edges leave and enter at the zone walls, so they run between columns and never through a label.
export function ports(layout: MapLayout): Map<string, { left: Port; right: Port }> {
  const zones = new Map(layout.zones.map((zone) => [zone.id, zone]));
  return new Map(
    layout.nodes.map((node) => {
      const zone = zones.get(node.zone);
      const left = zone?.x ?? node.x;
      const right = zone === undefined ? node.x : zone.x + zone.width;
      return [node.id, { left: { x: left, y: node.y }, right: { x: right, y: node.y } }];
    }),
  );
}

export const curve = (from: Port, to: Port): string => {
  const dx = Math.abs(to.x - from.x);
  const bend = Math.max(16, dx * 0.5);
  const sign = to.x >= from.x ? 1 : -1;
  return `M ${String(from.x)} ${String(from.y)} C ${String(from.x + sign * bend)} ${String(from.y)}, ${String(to.x - sign * bend)} ${String(to.y)}, ${String(to.x)} ${String(to.y)}`;
};

function Glyph({ node, fill, stroke }: { node: MapNode; fill: string; stroke: string }) {
  const common = { fill, stroke, strokeWidth: 1.5 };
  switch (node.type) {
    case 'tool':
    case 'system':
      return <rect x={node.x - 6} y={node.y - 6} width={12} height={12} rx={2} {...common} />;
    case 'grant':
      return (
        <polygon
          points={`${String(node.x)},${String(node.y - 7)} ${String(node.x + 7)},${String(node.y)} ${String(node.x)},${String(node.y + 7)} ${String(node.x - 7)},${String(node.y)}`}
          {...common}
        />
      );
    case 'resource':
      return <rect x={node.x - 7} y={node.y - 5} width={14} height={10} rx={5} {...common} />;
    case 'llm':
      return (
        <polygon
          points={`${String(node.x - 4)},${String(node.y - 7)} ${String(node.x + 4)},${String(node.y - 7)} ${String(node.x + 8)},${String(node.y)} ${String(node.x + 4)},${String(node.y + 7)} ${String(node.x - 4)},${String(node.y + 7)} ${String(node.x - 8)},${String(node.y)}`}
          {...common}
        />
      );
    default:
      return <circle cx={node.x} cy={node.y} r={7} {...common} />;
  }
}

// ARCHITECTURE §11: the stage is a pure function of the clock — zones never move, nodes light as events touch them.
export function MapScene({
  layout,
  frame,
  currentEvent,
  divergenceNodeId,
  diverged,
  blast,
  progress,
  onSelect,
}: MapSceneProps) {
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const accent = currentEvent?.provenance === 'observed' ? COLORS.ember : COLORS.cyan;
  const divergenceNode =
    divergenceNodeId === undefined ? undefined : layout.nodeOf(divergenceNodeId);
  const hops = blastHops(layout, blast);
  const portOf = ports(layout);
  const cursor = frame.cursor === undefined ? undefined : byId.get(frame.cursor);
  return (
    <svg
      viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`}
      className="block h-auto w-full"
      role="img"
      aria-label="map of the run: who acted, through what, on what"
      data-testid="map-scene"
      data-index={frame.index}
      data-cursor={frame.cursor ?? ''}
    >
      {layout.zones.map((zone) => {
        const hot = diverged && zone.id === 'production';
        return (
          <g key={zone.id} data-testid="zone" data-zone={zone.id}>
            <rect
              x={zone.x}
              y={zone.y}
              width={zone.width}
              height={zone.height}
              rx={8}
              fill={COLORS.stageRaised}
              stroke={hot ? COLORS.emberDim : COLORS.stageEdge}
              strokeWidth={1}
            />
            <text
              x={zone.x + 12}
              y={zone.y + 18}
              fontSize={10}
              letterSpacing={2}
              fill={hot ? COLORS.ember : COLORS.textMuted}
              className="font-mono uppercase"
            >
              {zone.label}
            </text>
          </g>
        );
      })}
      {layout.edges.map((edge) => {
        const from = portOf.get(edge.from);
        const to = portOf.get(edge.to);
        if (from === undefined || to === undefined || !frame.traversed.has(edge.id)) return null;
        const current = frame.currentEdges.has(edge.id);
        const rightward = to.left.x >= from.right.x;
        return (
          <path
            key={edge.id}
            d={rightward ? curve(from.right, to.left) : curve(from.left, to.right)}
            fill="none"
            stroke={current ? accent : EDGE_LIT}
            strokeWidth={current ? 2 : 1}
            strokeOpacity={current ? 1 : 0.9}
            data-testid="edge"
            data-edge={edge.id}
            data-current={current ? 'true' : 'false'}
          />
        );
      })}
      {layout.nodes.map((node) => {
        const touched = frame.touched.has(node.id);
        const current = frame.currentNodes.has(node.id);
        const hop = hops.get(node.id);
        const burnt = hop !== undefined && progress >= hop;
        const isDivergence = diverged && divergenceNode?.id === node.id;
        const fill = burnt
          ? COLORS.emberDim
          : current
            ? accent
            : touched
              ? COLORS.textMuted
              : COLORS.stage;
        const stroke =
          burnt || isDivergence
            ? COLORS.ember
            : current
              ? accent
              : touched
                ? COLORS.text
                : COLORS.stageEdge;
        return (
          <g
            key={node.id}
            data-testid="node"
            data-node={node.id}
            data-state={burnt ? 'burnt' : current ? 'current' : touched ? 'touched' : 'idle'}
            className={onSelect === undefined ? undefined : 'cursor-pointer'}
            onClick={
              onSelect === undefined
                ? undefined
                : () => {
                    onSelect(node);
                  }
            }
          >
            {isDivergence ? (
              <circle
                cx={node.x}
                cy={node.y}
                r={13}
                fill="none"
                stroke={COLORS.ember}
                strokeWidth={1.5}
                strokeDasharray="3 3"
                data-testid="divergence-ring"
              />
            ) : null}
            <Glyph node={node} fill={fill} stroke={stroke} />
            <text
              x={node.x + 14}
              y={node.y + 4}
              fontSize={13}
              fill={burnt ? COLORS.ember : touched ? COLORS.text : COLORS.textMuted}
              className={
                node.type === 'resource' || node.type === 'grant' ? 'font-mono' : 'font-sans'
              }
            >
              {shortLabel(node)}
            </text>
          </g>
        );
      })}
      {cursor === undefined ? null : (
        <g
          style={{
            transform: `translate(${String(cursor.x)}px, ${String(cursor.y)}px)`,
            transition: 'transform 350ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          }}
          data-testid="cursor"
        >
          <circle r={12} fill="none" stroke={accent} strokeWidth={1.5} opacity={0.9} />
          <circle r={16} fill={accent} opacity={0.12} />
        </g>
      )}
    </svg>
  );
}
