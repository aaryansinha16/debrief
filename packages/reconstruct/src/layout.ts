import {
  type SimulationLinkDatum,
  type SimulationNodeDatum,
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from 'd3-force';

import { seededRandom } from './random.js';
import type { CausalGraph, NodeType } from './types.js';

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface Layout {
  version: string;
  seed: string;
  iterations: number;
  positions: Record<string, Position>;
  bounds: { min: Position; max: Position };
}

export const LAYOUT_VERSION = '1';
export const LAYOUT_ITERATIONS = 300;

// Depth by role so the Theatre reads authority above action above the world.
export const LAYERS: Record<NodeType, number> = {
  principal: 6,
  human: 6,
  grant: 4,
  agent: 3,
  subagent: 3,
  llm: 1,
  tool: 0,
  policy: 2,
  system: -2,
  resource: -4,
};

// Rounded to 0.01 and never -0, so JSON round-trips byte-identically.
const round = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
};

interface LayoutNode extends SimulationNodeDatum {
  id: string;
  type: NodeType;
  x: number;
  y: number;
}

// ARCHITECTURE §9: seeded force layout, fixed iteration count, positions rounded to 0.01.
export function layout(graph: CausalGraph, seed: string): Layout {
  const random = seededRandom(seed);
  const radius = 20 * Math.sqrt(graph.nodes.length);
  const nodes: LayoutNode[] = graph.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    x: (random() - 0.5) * radius,
    y: (random() - 0.5) * radius,
  }));
  const links: SimulationLinkDatum<LayoutNode>[] = graph.edges.map((edge) => ({
    source: edge.from,
    target: edge.to,
  }));
  const simulation = forceSimulation<LayoutNode>(nodes)
    .randomSource(random)
    .force(
      'link',
      forceLink<LayoutNode, SimulationLinkDatum<LayoutNode>>(links)
        .id((node) => node.id)
        .distance(30),
    )
    .force('charge', forceManyBody<LayoutNode>().strength(-120))
    .force('center', forceCenter(0, 0))
    .force('collide', forceCollide<LayoutNode>(8))
    .stop();
  simulation.tick(LAYOUT_ITERATIONS);
  const positions: Record<string, Position> = {};
  const min: Position = { x: Infinity, y: Infinity, z: Infinity };
  const max: Position = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const node of nodes) {
    const position: Position = { x: round(node.x), y: round(node.y), z: LAYERS[node.type] };
    positions[node.id] = position;
    for (const axis of ['x', 'y', 'z'] as const) {
      min[axis] = Math.min(min[axis], position[axis]);
      max[axis] = Math.max(max[axis], position[axis]);
    }
  }
  const empty = graph.nodes.length === 0;
  return {
    version: LAYOUT_VERSION,
    seed,
    iterations: LAYOUT_ITERATIONS,
    positions,
    bounds: empty ? { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } } : { min, max },
  };
}
