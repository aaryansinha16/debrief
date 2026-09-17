import type { BlastRadius } from './blast.js';
import type { DivergenceReport } from './divergence.js';
import type { Layout, Position } from './layout.js';
import type { CausalGraph, GraphNode } from './types.js';

export type Easing = 'linear' | 'ease-in-out' | 'ease-out';
export type ShotLabel = 'establishing' | 'follow' | 'freeze' | 'ripple' | 'pull-back';

export interface Keyframe {
  t: number;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  easing: Easing;
  label: ShotLabel;
  nodeId?: string;
}

export const DIRECTOR_VERSION = '1';
export const MAX_FOLLOW_SHOTS = 48;

// Rounded to 0.01 and never -0, so JSON round-trips byte-identically.
const round = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
};
const vec = (p: Position): [number, number, number] => [round(p.x), round(p.y), round(p.z)];
const add = (p: Position, dx: number, dy: number, dz: number): Position => ({
  x: p.x + dx,
  y: p.y + dy,
  z: p.z + dz,
});

function centroid(points: readonly Position[]): Position {
  if (points.length === 0) return { x: 0, y: 0, z: 0 };
  const sum = points.reduce((acc, p) => add(acc, p.x, p.y, p.z), { x: 0, y: 0, z: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length, z: sum.z / points.length };
}

const secondsBetween = (from: string, to: string): number =>
  round(Math.max(0, (Date.parse(to) - Date.parse(from)) / 1000));

function sample<T>(items: readonly T[], limit: number): T[] {
  if (items.length <= limit) return [...items];
  const step = (items.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => items[Math.round(index * step)]).filter(
    (item): item is T => item !== undefined,
  );
}

// ARCHITECTURE §9: establishing → follow the agent → freeze at the divergence → ripple by wave → pull back to the lineage.
export function direct(
  graph: CausalGraph,
  layout: Layout,
  divergence?: DivergenceReport,
  blast?: BlastRadius,
): Keyframe[] {
  const at = (node: GraphNode): Position => layout.positions[node.id] ?? { x: 0, y: 0, z: 0 };
  const [first] = graph.nodes;
  if (first === undefined) return [];
  const frames: Keyframe[] = [];
  const all = graph.nodes.map(at);
  const center = centroid(all);
  const spread = Math.max(
    layout.bounds.max.x - layout.bounds.min.x,
    layout.bounds.max.y - layout.bounds.min.y,
    40,
  );
  const start = graph.nodes.reduce(
    (earliest, node) => (node.ts < earliest ? node.ts : earliest),
    first.ts,
  );
  frames.push({
    t: 0,
    position: vec(add(center, 0, -spread * 0.6, spread * 1.2)),
    target: vec(center),
    fov: 50,
    easing: 'ease-in-out',
    label: 'establishing',
  });
  const tools = graph.nodes.filter((node) => node.type === 'tool');
  const freezeNode =
    divergence?.freezeFrame?.nodeId === undefined
      ? undefined
      : graph.nodes.find((node) => node.id === divergence.freezeFrame?.nodeId);
  const followed = sample(
    freezeNode === undefined ? tools : tools.filter((node) => node.ts < freezeNode.ts),
    MAX_FOLLOW_SHOTS,
  );
  let t = 0;
  for (const node of followed) {
    t = Math.max(t, secondsBetween(start, node.ts));
    frames.push({
      t,
      position: vec(add(at(node), 12, -18, 22)),
      target: vec(at(node)),
      fov: 45,
      easing: 'linear',
      label: 'follow',
      nodeId: node.id,
    });
  }
  if (freezeNode !== undefined) {
    t = Math.max(t, secondsBetween(start, freezeNode.ts));
    frames.push({
      t,
      position: vec(add(at(freezeNode), 6, -9, 12)),
      target: vec(at(freezeNode)),
      fov: 35,
      easing: 'ease-out',
      label: 'freeze',
      nodeId: freezeNode.id,
    });
    for (const wave of blast?.waves ?? []) {
      t = round(t + 1.5);
      const touched = wave.resources
        .map((entry) => layout.positions[entry.nodeId])
        .filter((position): position is Position => position !== undefined);
      const focus = centroid([at(freezeNode), ...touched]);
      const reach = 16 + wave.hop * 10;
      frames.push({
        t,
        position: vec(add(focus, reach * 0.5, -reach, reach * 1.2)),
        target: vec(focus),
        fov: 40 + wave.hop * 4,
        easing: 'ease-in-out',
        label: 'ripple',
      });
    }
  }
  const principal = graph.nodes.find((node) => node.type === 'principal' || node.type === 'human');
  const anchor = freezeNode ?? followed.at(-1);
  const lineageFocus = centroid(
    [principal, anchor].filter((n): n is GraphNode => n !== undefined).map(at),
  );
  t = round(t + 2);
  frames.push({
    t,
    position: vec(add(lineageFocus, 0, -spread * 0.8, spread * 1.4)),
    target: vec(lineageFocus),
    fov: 55,
    easing: 'ease-in-out',
    label: 'pull-back',
  });
  return frames;
}
