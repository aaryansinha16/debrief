import {
  MAP_HEIGHT,
  MAP_WIDTH,
  type MapFrame,
  type MapLayout,
  type MapNode,
  type ZoneId,
} from './map-layout';

export type Vec3 = readonly [number, number, number];

export const SCALE = 0.5;
export const NODE_HEIGHT = 6;
export const PLATFORM_HEIGHT = 4;
export const EDGE_ARC = 22;
export const EDGE_SAMPLES = 24;
export const PACKET_MS = 450;
export const CAMERA_GLIDE_MS = 700;
export const CAMERA_OFFSET: Vec3 = [0, 235, 235];
export const CAMERA_PUSH: Vec3 = [0, 215, 215];
export const FOCUS_PULL = 0.18;

// Map coordinates (0..1000 × 0..480, y down) become a ground plane: x stays x, map y becomes depth, up is up.
export const toWorld = (x: number, y: number, height = 0): Vec3 => [
  (x - MAP_WIDTH / 2) * SCALE,
  height,
  (y - MAP_HEIGHT / 2) * SCALE,
];

export interface StageZone {
  id: ZoneId;
  label: string;
  center: Vec3;
  size: readonly [number, number];
  labelAt: Vec3;
}

export interface StageNode {
  id: string;
  type: MapNode['type'];
  label: string;
  zone: ZoneId;
  position: Vec3;
  labelAt: Vec3;
}

export interface StageEdge {
  id: string;
  from: string;
  to: string;
  points: Vec3[];
}

export interface StageModel {
  zones: StageZone[];
  nodes: StageNode[];
  edges: StageEdge[];
  center: Vec3;
  zoneOf(nodeId: string): StageZone | undefined;
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
export const mix = (a: Vec3, b: Vec3, k: number): Vec3 => [
  lerp(a[0], b[0], k),
  lerp(a[1], b[1], k),
  lerp(a[2], b[2], k),
];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// Smoothstep: eases both ends, and a seek to any t lands on the same pose.
export const ease = (k: number): number => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};

// An edge is a quadratic arc from node to node lifted above the platforms; sampled once, drawn as a tube.
export function arc(from: Vec3, to: Vec3, samples = EDGE_SAMPLES): Vec3[] {
  const control: Vec3 = [
    (from[0] + to[0]) / 2,
    Math.max(from[1], to[1]) + EDGE_ARC,
    (from[2] + to[2]) / 2,
  ];
  const points: Vec3[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const s = i / samples;
    const a = mix(from, control, s);
    const b = mix(control, to, s);
    points.push(mix(a, b, s));
  }
  return points;
}

export function pointAt(points: readonly Vec3[], phase: number): Vec3 {
  const k = Math.min(1, Math.max(0, phase)) * (points.length - 1);
  const index = Math.floor(k);
  const a = points[index] ?? points[points.length - 1] ?? [0, 0, 0];
  const b = points[index + 1] ?? a;
  return mix(a, b, k - index);
}

export function stageModel(layout: MapLayout): StageModel {
  const zones: StageZone[] = layout.zones.map((zone) => ({
    id: zone.id,
    label: zone.label,
    center: toWorld(zone.x + zone.width / 2, zone.y + zone.height / 2),
    size: [zone.width * SCALE, zone.height * SCALE],
    labelAt: toWorld(zone.x + 12, zone.y + 14, PLATFORM_HEIGHT + 1),
  }));
  const byZone = new Map(zones.map((zone) => [zone.id, zone]));
  const nodes: StageNode[] = layout.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    label: node.label,
    zone: node.zone,
    position: toWorld(node.x, node.y, PLATFORM_HEIGHT + NODE_HEIGHT),
    labelAt: toWorld(node.x + 14, node.y, PLATFORM_HEIGHT + NODE_HEIGHT),
  }));
  const position = new Map(nodes.map((node) => [node.id, node.position]));
  const edges: StageEdge[] = layout.edges.flatMap((edge) => {
    const from = position.get(edge.from);
    const to = position.get(edge.to);
    return from === undefined || to === undefined
      ? []
      : [{ id: edge.id, from: edge.from, to: edge.to, points: arc(from, to) }];
  });
  const zoneOfNode = new Map(nodes.map((node) => [node.id, byZone.get(node.zone)]));
  return {
    zones,
    nodes,
    edges,
    center: [0, 0, -62],
    zoneOf: (nodeId) => zoneOfNode.get(nodeId),
  };
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

export interface CameraInput {
  t: number;
  eventT: number | undefined;
  previous: Vec3 | undefined;
  current: Vec3 | undefined;
  pushed: boolean;
}

// ARCHITECTURE §11: the camera follows the story — it glides from the last place to the current one over CAMERA_GLIDE_MS
// after the event lands, and pushes in when the story pushes in. All of it is a function of the clock (D-069).
export function cameraPose(model: StageModel, input: CameraInput): CameraPose {
  const home = model.center;
  const from = input.previous ?? home;
  const to = input.current ?? home;
  const k = input.eventT === undefined ? 1 : ease((input.t - input.eventT) / CAMERA_GLIDE_MS);
  const focus = mix(from, to, k);
  const target = mix(home, focus, FOCUS_PULL);
  const offset = input.pushed ? CAMERA_PUSH : CAMERA_OFFSET;
  return { position: add(target, offset), target };
}

// Where the light packet is on the current edge: it leaves the source when the event lands and arrives PACKET_MS later.
export const packetPhase = (t: number, eventT: number | undefined): number =>
  eventT === undefined ? 1 : Math.min(1, Math.max(0, (t - eventT) / PACKET_MS));

// After the divergence the story is the blast: the camera settles between the offending call and the zone it hit.
export function blastFocus(
  model: StageModel,
  divergenceNodeId: string | undefined,
): Vec3 | undefined {
  const node = model.nodes.find((candidate) => candidate.id === divergenceNodeId);
  if (node === undefined) return undefined;
  const production = model.zones.find((zone) => zone.id === 'production');
  return production === undefined ? node.position : mix(node.position, production.center, 0.55);
}

// The frame's cursor and the previous frame's cursor, as world points for the camera to glide between.
export function focusPoints(
  model: StageModel,
  frame: MapFrame,
  previous: MapFrame | undefined,
): { previous: Vec3 | undefined; current: Vec3 | undefined } {
  const at = (id: string | undefined): Vec3 | undefined =>
    id === undefined ? undefined : model.zoneOf(id)?.center;
  return { previous: at(previous?.cursor), current: at(frame.cursor) };
}
