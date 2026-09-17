import type { Event, Provenance } from '@debrief/schema';
import { COLORS } from '@debrief/ui';

import type { CausalGraph, GraphEdge, GraphNode, Layout } from './api';

export interface SceneNode {
  id: string;
  index: number;
  type: GraphNode['type'];
  label: string;
  position: [number, number, number];
  radius: number;
  color: string;
  provenance: Provenance;
  eventIds: string[];
  summary?: string;
}

export interface SceneEdge {
  from: number;
  to: number;
  type: GraphEdge['type'];
  confidence: GraphEdge['confidence'];
  provenance: Provenance;
}

export interface SceneData {
  nodes: SceneNode[];
  edges: SceneEdge[];
  positions: Float32Array;
  colors: Float32Array;
  radii: Float32Array;
  segments: Float32Array;
  segmentColors: Float32Array;
  center: [number, number, number];
  radiusOfGraph: number;
}

// Design language (§11): cyan for authority, ember for risk and the observed world, off-white for actors.
export const NODE_COLORS: Record<GraphNode['type'], string> = {
  principal: COLORS.text,
  human: COLORS.text,
  agent: COLORS.cyan,
  subagent: COLORS.cyan,
  grant: COLORS.cyanDim,
  llm: COLORS.textMuted,
  tool: COLORS.text,
  system: COLORS.textMuted,
  resource: COLORS.ember,
  policy: COLORS.emberDim,
};

export const NODE_RADII: Record<GraphNode['type'], number> = {
  principal: 4,
  human: 4,
  agent: 4,
  subagent: 3.5,
  grant: 2.5,
  llm: 2,
  tool: 2.5,
  system: 3,
  resource: 3.5,
  policy: 2,
};

const EDGE_COLORS: Record<Provenance, string> = {
  reported: COLORS.stageEdge,
  observed: COLORS.emberDim,
};

// Beyond this many nodes the scene switches to far LOD: flat dots, edges only around the hovered node (§11 budget on software GL).
export const LOD_NODE_THRESHOLD = 1000;

export interface EdgeBuffers {
  segments: Float32Array;
  segmentColors: Float32Array;
}

export function edgesTouching(scene: SceneData, index: number | undefined): EdgeBuffers {
  if (index === undefined)
    return { segments: new Float32Array(0), segmentColors: new Float32Array(0) };
  const picked = scene.edges
    .map((edge, position) => ({ edge, position }))
    .filter(({ edge }) => edge.from === index || edge.to === index);
  const segments = new Float32Array(picked.length * 6);
  const segmentColors = new Float32Array(picked.length * 6);
  picked.forEach(({ position }, slot) => {
    segments.set(scene.segments.subarray(position * 6, position * 6 + 6), slot * 6);
    segmentColors.set(scene.segmentColors.subarray(position * 6, position * 6 + 6), slot * 6);
  });
  return { segments, segmentColors };
}

export interface EdgeQuads {
  position: Float32Array;
  other: Float32Array;
  side: Float32Array;
  color: Float32Array;
  index: Uint32Array;
}

// Edges as screen-space quads, two triangles each: a software rasterizer pays per primitive and a GL line costs many triangles' worth (D-055).
// Vertex order a−, a+, b+, b−; the side flips at b so both ends offset toward the same screen side of the segment.
export function edgeQuads(buffers: EdgeBuffers): EdgeQuads {
  const count = buffers.segments.length / 6;
  const position = new Float32Array(count * 12);
  const other = new Float32Array(count * 12);
  const side = new Float32Array(count * 4);
  const color = new Float32Array(count * 12);
  const index = new Uint32Array(count * 6);
  for (let segment = 0; segment < count; segment += 1) {
    const a = buffers.segments.subarray(segment * 6, segment * 6 + 3);
    const b = buffers.segments.subarray(segment * 6 + 3, segment * 6 + 6);
    const colorA = buffers.segmentColors.subarray(segment * 6, segment * 6 + 3);
    const colorB = buffers.segmentColors.subarray(segment * 6 + 3, segment * 6 + 6);
    for (let vertex = 0; vertex < 4; vertex += 1) {
      const at = (segment * 4 + vertex) * 3;
      position.set(vertex < 2 ? a : b, at);
      other.set(vertex < 2 ? b : a, at);
      color.set(vertex < 2 ? colorA : colorB, at);
      side[segment * 4 + vertex] = vertex % 2 === 0 ? -1 : 1;
    }
    const base = segment * 4;
    index.set([base, base + 1, base + 2, base, base + 2, base + 3], segment * 6);
  }
  return { position, other, side, color, index };
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

// A node or edge is `observed` only when every event behind it was observed; the two are never merged.
export function provenanceOf(
  eventIds: readonly string[],
  events: ReadonlyMap<string, Event>,
): Provenance {
  const known = eventIds
    .map((id) => events.get(id))
    .filter((event): event is Event => event !== undefined);
  return known.length > 0 && known.every((event) => event.provenance === 'observed')
    ? 'observed'
    : 'reported';
}

export function buildSceneData(
  graph: CausalGraph,
  layout: Layout,
  events: readonly Event[] = [],
): SceneData {
  const byId = new Map(events.map((event) => [event.id, event]));
  const nodes: SceneNode[] = graph.nodes.map((node, index) => {
    const at = layout.positions[node.id] ?? { x: 0, y: 0, z: 0 };
    const first = node.eventIds
      .map((id) => byId.get(id))
      .find((event) => event?.summary !== undefined);
    const sceneNode: SceneNode = {
      id: node.id,
      index,
      type: node.type,
      label: node.label,
      position: [at.x, at.y, at.z],
      radius: NODE_RADII[node.type],
      color: NODE_COLORS[node.type],
      provenance: provenanceOf(node.eventIds, byId),
      eventIds: node.eventIds,
    };
    if (first?.summary !== undefined) sceneNode.summary = first.summary;
    return sceneNode;
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges: SceneEdge[] = [];
  const segmentList: number[] = [];
  const segmentColorList: number[] = [];
  for (const edge of graph.edges) {
    const a = nodeById.get(edge.from);
    const b = nodeById.get(edge.to);
    if (a === undefined || b === undefined) continue;
    const provenance = provenanceOf(edge.eventIds, byId);
    edges.push({
      from: a.index,
      to: b.index,
      type: edge.type,
      confidence: edge.confidence,
      provenance,
    });
    segmentList.push(...a.position, ...b.position);
    const rgb = hexToRgb(EDGE_COLORS[provenance]);
    segmentColorList.push(...rgb, ...rgb);
  }
  const positions = new Float32Array(nodes.length * 3);
  const colors = new Float32Array(nodes.length * 3);
  const radii = new Float32Array(nodes.length);
  const sum: [number, number, number] = [0, 0, 0];
  nodes.forEach((node, index) => {
    positions.set(node.position, index * 3);
    colors.set(hexToRgb(node.color), index * 3);
    radii[index] = node.radius;
    sum[0] += node.position[0];
    sum[1] += node.position[1];
    sum[2] += node.position[2];
  });
  const count = Math.max(1, nodes.length);
  const center: [number, number, number] = [sum[0] / count, sum[1] / count, sum[2] / count];
  const radiusOfGraph = nodes.reduce(
    (max, node) =>
      Math.max(max, Math.hypot(node.position[0] - center[0], node.position[1] - center[1])),
    0,
  );
  const segments = Float32Array.from(segmentList);
  const segmentColors = Float32Array.from(segmentColorList);
  return { nodes, edges, positions, colors, radii, segments, segmentColors, center, radiusOfGraph };
}

// A deterministic ring-of-clusters graph for the perf probe: `count` nodes, ~1.5 edges per node.
export function syntheticScene(count: number): { graph: CausalGraph; layout: Layout } {
  const types: GraphNode['type'][] = ['tool', 'llm', 'resource', 'system', 'agent'];
  const typeAt = (index: number): GraphNode['type'] => {
    const [type = 'tool'] = types.slice(index % types.length);
    return type;
  };
  const nodes: GraphNode[] = [];
  const positions: Layout['positions'] = {};
  for (let index = 0; index < count; index += 1) {
    const id = `n${String(index)}`;
    const angle = index * 2.399963;
    const ring = Math.sqrt(index) * 6;
    nodes.push({ id, type: typeAt(index), label: id, ts: '', eventIds: [] });
    positions[id] = { x: Math.cos(angle) * ring, y: Math.sin(angle) * ring, z: (index % 5) - 2 };
  }
  // Edges stay local, as force layouts keep linked nodes close: each node links to its two predecessors on the spiral.
  const edges: GraphEdge[] = [];
  for (let index = 1; index < count; index += 1) {
    edges.push({
      from: `n${String(index)}`,
      to: `n${String(index - 1)}`,
      type: 'calls',
      confidence: 'exact',
      eventIds: [],
    });
    if (index >= 2 && index % 2 === 0) {
      edges.push({
        from: `n${String(index)}`,
        to: `n${String(index - 2)}`,
        type: 'observes',
        confidence: 'strong',
        eventIds: [],
      });
    }
  }
  const extent = Math.sqrt(count) * 6 + 1;
  return {
    graph: { runId: 'synthetic', version: '1', nodes, edges },
    layout: {
      version: '1',
      seed: 'synthetic',
      iterations: 0,
      positions,
      bounds: { min: { x: -extent, y: -extent, z: -2 }, max: { x: extent, y: extent, z: 2 } },
    },
  };
}
