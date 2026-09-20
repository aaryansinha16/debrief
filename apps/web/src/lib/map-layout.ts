import type { Event } from '@debrief/schema';

import type { CausalGraph, GraphEdge, GraphNode } from './api';

export type ZoneId =
  | 'people'
  | 'agent'
  | 'tokens'
  | 'model'
  | 'tools'
  | 'systems'
  | 'staging'
  | 'production'
  | 'resources'
  | 'policy';

export interface MapNode {
  id: string;
  type: GraphNode['type'];
  label: string;
  zone: ZoneId;
  graphIds: string[];
  eventIds: string[];
  x: number;
  y: number;
}

export interface MapEdge {
  id: string;
  from: string;
  to: string;
  type: GraphEdge['type'];
  eventIds: string[];
}

export interface MapZone {
  id: ZoneId;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  nodeIds: string[];
}

export interface MapLayout {
  width: number;
  height: number;
  zones: MapZone[];
  nodes: MapNode[];
  edges: MapEdge[];
  nodeOf(graphId: string): MapNode | undefined;
}

export const MAP_WIDTH = 1000;
export const MAP_HEIGHT = 480;
const GUTTER = 12;
const ZONE_GAP = 12;
const ZONE_HEAD = 30;
const ZONE_FOOT = 10;
const ROW = 30;
const MAX_ROW = 44;
const NODE_INSET = 20;
export const LABEL_CHARS = 24;

// ARCHITECTURE §11: position carries meaning — reading left to right is reading who acted, through what, on what.
const COLUMNS: readonly { zones: readonly ZoneId[]; width: number }[] = [
  { zones: ['people', 'model'], width: 168 },
  { zones: ['agent', 'tokens'], width: 200 },
  { zones: ['tools', 'policy'], width: 176 },
  { zones: ['systems'], width: 150 },
  { zones: ['staging', 'production', 'resources'], width: 234 },
];

export const ZONE_LABELS: Record<ZoneId, string> = {
  people: 'people',
  agent: 'agent',
  tokens: 'tokens',
  model: 'model',
  tools: 'tools',
  systems: 'systems',
  staging: 'staging',
  production: 'production',
  resources: 'resources',
  policy: 'policy',
};

// Calls to the same model or tool collapse into one place on the map; the graph keeps every call apart.
const groupKey = (node: GraphNode): string =>
  node.type === 'llm' || node.type === 'tool' ? `${node.type}:${node.label}` : node.id;

const environmentOf = (node: GraphNode, byId: ReadonlyMap<string, Event>): ZoneId => {
  for (const eventId of node.eventIds) {
    const environment = byId.get(eventId)?.target?.environment;
    if (environment === 'production') return 'production';
    if (environment === 'staging') return 'staging';
  }
  return 'resources';
};

function zoneOf(node: GraphNode, byId: ReadonlyMap<string, Event>): ZoneId {
  switch (node.type) {
    case 'principal':
    case 'human':
      return 'people';
    case 'agent':
    case 'subagent':
      return 'agent';
    case 'grant':
      return 'tokens';
    case 'llm':
      return 'model';
    case 'tool':
      return 'tools';
    case 'system':
      return 'systems';
    case 'policy':
      return 'policy';
    case 'resource':
      return environmentOf(node, byId);
  }
}

// A resource path reads as its last segments; anything longer than a column is cut with an ellipsis.
export const shortLabel = (node: Pick<MapNode, 'type' | 'label'>): string => {
  let label = node.label;
  if (node.type === 'resource') {
    const parts = label.split('/');
    if (parts.length > 2) label = parts.slice(-2).join('/');
  }
  return label.length > LABEL_CHARS ? `${label.slice(0, LABEL_CHARS - 1)}…` : label;
};

export function mapLayout(graph: CausalGraph, events: readonly Event[]): MapLayout {
  const byId = new Map(events.map((event) => [event.id, event]));
  const grouped = new Map<string, MapNode>();
  const groupOf = new Map<string, string>();
  for (const node of graph.nodes) {
    const key = groupKey(node);
    groupOf.set(node.id, key);
    const existing = grouped.get(key);
    if (existing === undefined) {
      grouped.set(key, {
        id: key,
        type: node.type,
        label: node.label,
        zone: zoneOf(node, byId),
        graphIds: [node.id],
        eventIds: [...node.eventIds],
        x: 0,
        y: 0,
      });
    } else {
      existing.graphIds.push(node.id);
      existing.eventIds.push(...node.eventIds);
    }
  }
  const nodes = [...grouped.values()];
  const zones: MapZone[] = [];
  let x = GUTTER;
  for (const { zones: column, width } of COLUMNS) {
    const present = column
      .map((zone) => ({ zone, members: nodes.filter((node) => node.zone === zone) }))
      .filter(({ members }) => members.length > 0)
      .map((entry) => ({ ...entry, wanted: ZONE_HEAD + ZONE_FOOT + ROW * entry.members.length }));
    const available = MAP_HEIGHT - 2 * GUTTER - ZONE_GAP * Math.max(0, present.length - 1);
    const total = present.reduce((sum, entry) => sum + entry.wanted, 0);
    // Zones share the whole column height in proportion to their rows; inside a zone rows spread up to MAX_ROW and sit centred.
    const scale = available / total;
    let y = GUTTER;
    for (const { zone, members, wanted } of present) {
      const height = wanted * scale;
      const inner = height - ZONE_HEAD - ZONE_FOOT;
      const row = Math.min(MAX_ROW, inner / members.length);
      const top = y + ZONE_HEAD + (inner - row * members.length) / 2;
      members.forEach((node, memberIndex) => {
        node.x = x + NODE_INSET;
        node.y = top + row * (memberIndex + 0.5);
      });
      zones.push({
        id: zone,
        label: ZONE_LABELS[zone],
        x,
        y,
        width,
        height,
        nodeIds: members.map((node) => node.id),
      });
      y += height + ZONE_GAP;
    }
    x += width + ZONE_GAP;
  }
  const edges = new Map<string, MapEdge>();
  for (const edge of graph.edges) {
    const from = groupOf.get(edge.from);
    const to = groupOf.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    const id = `${from}→${to}:${edge.type}`;
    const existing = edges.get(id);
    if (existing === undefined)
      edges.set(id, { id, from, to, type: edge.type, eventIds: [...edge.eventIds] });
    else existing.eventIds.push(...edge.eventIds);
  }
  return {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    zones,
    nodes,
    edges: [...edges.values()],
    nodeOf: (graphId) => {
      const key = groupOf.get(graphId);
      return key === undefined ? undefined : grouped.get(key);
    },
  };
}

export interface MapFrame {
  index: number;
  currentEventId?: string;
  touched: ReadonlySet<string>;
  currentNodes: ReadonlySet<string>;
  traversed: ReadonlySet<string>;
  currentEdges: ReadonlySet<string>;
  cursor?: string;
}

// Where an event lands on the map: the end of an edge it travels, else a node it touches, else nowhere.
function landing(layout: MapLayout, eventId: string): string | undefined {
  const edge = layout.edges.find((candidate) => candidate.eventIds.includes(eventId));
  if (edge !== undefined) return edge.to;
  return layout.nodes.find((candidate) => candidate.eventIds.includes(eventId))?.id;
}

// Everything the stage shows at one clock position, from the count of events already applied; a pure function of that count (D-069).
export function mapFrame(layout: MapLayout, order: readonly string[], index: number): MapFrame {
  const applied = new Set(order.slice(0, index));
  const currentEventId = order[index - 1];
  const touched = new Set<string>();
  const currentNodes = new Set<string>();
  for (const node of layout.nodes) {
    if (node.eventIds.some((id) => applied.has(id))) touched.add(node.id);
    if (currentEventId !== undefined && node.eventIds.includes(currentEventId)) {
      currentNodes.add(node.id);
    }
  }
  const traversed = new Set<string>();
  const currentEdges = new Set<string>();
  for (const edge of layout.edges) {
    if (edge.eventIds.some((id) => applied.has(id))) traversed.add(edge.id);
    if (currentEventId !== undefined && edge.eventIds.includes(currentEventId)) {
      currentEdges.add(edge.id);
    }
  }
  // The cursor rests where the latest applied event landed, so a seek to any t finds it in the same place.
  let cursor: string | undefined;
  for (const id of order.slice(0, index).reverse()) {
    cursor = landing(layout, id);
    if (cursor !== undefined) break;
  }
  return {
    index,
    ...(currentEventId === undefined ? {} : { currentEventId }),
    touched,
    currentNodes,
    traversed,
    currentEdges,
    ...(cursor === undefined ? {} : { cursor }),
  };
}
