import { hierarchy, tree } from 'd3-hierarchy';

import type { Lineage, LineageHop, ScopeMismatch } from './api';

export type Severity = ScopeMismatch['severity'];

export interface LineageNode {
  id: string;
  kind: 'hop' | 'action';
  type: string;
  label: string;
  hop?: LineageHop;
  action?: Lineage['action'];
  severity?: Severity;
  children: LineageNode[];
}

export interface PlacedNode extends Omit<LineageNode, 'children'> {
  index: number;
  depth: number;
  x: number;
  y: number;
}

export interface LineageLayout {
  nodes: PlacedNode[];
  action: PlacedNode;
  links: { from: PlacedNode; to: PlacedNode }[];
  width: number;
  height: number;
}

export const GAP_X = 220;
export const GAP_Y = 120;
export const MARGIN = { x: 90, y: 70 };

export const severityOf = (hop: LineageHop): Severity | undefined => {
  const mismatches = hop.scopeMismatch ?? [];
  if (mismatches.some((mismatch) => mismatch.severity === 'major')) return 'major';
  return mismatches.length > 0 ? 'minor' : undefined;
};

export function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`lineage layout is missing its ${what}`);
  return value;
}

export const describeMismatch = (mismatch: ScopeMismatch): string =>
  mismatch.kind === 'permissions-exceed-scope'
    ? `permissions exceed scope: ${mismatch.excess.map((item) => `+${item}`).join(', ')}`
    : `target outside scope: ${mismatch.target ?? mismatch.excess.join(', ')}`;

// The chain of custody as a hierarchy: the principal at the root, each hop under the previous, the action as the leaf.
export function lineageNodes(lineage: Lineage): LineageNode {
  const action: LineageNode = {
    id: lineage.action.nodeId,
    kind: 'action',
    type: 'action',
    label: lineage.action.label,
    action: lineage.action,
    children: [],
  };
  return [...lineage.hops].reverse().reduce<LineageNode>((child, hop) => {
    const node: LineageNode = {
      id: hop.nodeId,
      kind: 'hop',
      type: hop.type,
      label: hop.label,
      hop,
      children: [child],
    };
    const severity = severityOf(hop);
    if (severity !== undefined) node.severity = severity;
    return node;
  }, action);
}

// ARCHITECTURE §11: an SVG tree from d3-hierarchy, laid out left to right so the reader follows authority to the action.
export function lineageTree(lineage: Lineage): LineageLayout {
  const root = tree<LineageNode>().nodeSize([GAP_Y, GAP_X])(hierarchy(lineageNodes(lineage)));
  const placed = root.descendants();
  const minY = Math.min(...placed.map((node) => node.x));
  const maxY = Math.max(...placed.map((node) => node.x));
  const maxDepth = Math.max(...placed.map((node) => node.depth));
  const byNode = new Map<LineageNode, PlacedNode>();
  const nodes: PlacedNode[] = [];
  const links: LineageLayout['links'] = [];
  for (const [index, node] of placed.entries()) {
    const { children: _children, ...rest } = node.data;
    const entry: PlacedNode = {
      ...rest,
      index,
      depth: node.depth,
      x: MARGIN.x + node.depth * GAP_X,
      y: MARGIN.y + (node.x - minY),
    };
    byNode.set(node.data, entry);
    nodes.push(entry);
    const parent = node.parent === null ? undefined : byNode.get(node.parent.data);
    if (parent !== undefined) links.push({ from: parent, to: entry });
  }
  return {
    nodes,
    action: must(
      nodes.find((entry) => entry.kind === 'action'),
      'action',
    ),
    links,
    width: MARGIN.x * 2 + maxDepth * GAP_X,
    height: MARGIN.y * 2 + (maxY - minY),
  };
}

// The hop the reader should land on: the first major mismatch, else the first minor one, else the action.
export const initialFocus = (layout: LineageLayout): number => {
  const major = layout.nodes.find((node) => node.severity === 'major');
  const minor = layout.nodes.find((node) => node.severity === 'minor');
  return (major ?? minor)?.index ?? layout.nodes.length - 1;
};

// Roving focus over the tree items: arrows walk the chain, Home and End jump to its ends.
export function nextFocus(key: string, current: number, count: number): number | undefined {
  if (count === 0) return undefined;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return Math.min(count - 1, current + 1);
    case 'ArrowLeft':
    case 'ArrowUp':
      return Math.max(0, current - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}
