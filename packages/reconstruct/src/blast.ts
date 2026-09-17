import type { Event } from '@debrief/schema';

import { isMutatingOperation } from './graph.js';
import { CONFIDENCE_RANK, type CausalGraph, type Confidence, type GraphEdge } from './types.js';

export type RecoverabilityReason =
  | 'backups-deleted'
  | 'backup-exists'
  | 'irreversible-operation'
  | 'reversible-operation'
  | 'read-only';

export interface BlastResource {
  nodeId: string;
  system: string;
  resource: string;
  via: GraphEdge;
  recoverable: boolean;
  reasons: RecoverabilityReason[];
}

export interface BlastWave {
  hop: number;
  resources: BlastResource[];
}

export interface BlastRadius {
  origin: string;
  minConfidence: Confidence;
  waves: BlastWave[];
  groups: Record<string, string[]>;
  recoverable: boolean;
}

export interface BlastOptions {
  includeWeak?: boolean;
}

const IRREVERSIBLE_VERBS = ['delete', 'remove', 'drop', 'destroy', 'purge', 'truncate', 'kill'];

const isIrreversible = (operation: string | undefined): boolean => {
  const verb = (operation ?? '').toLowerCase();
  return IRREVERSIBLE_VERBS.some((prefix) => verb.startsWith(prefix));
};

const asNumber = (value: unknown): number => (typeof value === 'number' ? value : 0);

// ARCHITECTURE §8: the Orbital hook reports `backupExists` before/after and how many backups went with a volume.
export function withConsequences(graph: CausalGraph, events: readonly Event[]): CausalGraph {
  const nodes = graph.nodes.map((node) => ({ ...node, eventIds: [...node.eventIds] }));
  const edges = graph.edges.map((edge) => ({ ...edge, eventIds: [...edge.eventIds] }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.kind !== 'world.change' || event.target?.resource === undefined) continue;
    const lost = asNumber(event.attrs['world.backupsDeleted']);
    const backupsGone =
      event.attrs['world.field'] === 'backupExists' && event.attrs['world.after'] === false;
    if (lost === 0 && !backupsGone) continue;
    const { system, resource } = event.target;
    const from = `resource:${system}:${resource}`;
    if (!nodeIds.has(from)) continue;
    const id = `${from}/backups`;
    if (!nodeIds.has(id)) {
      nodeIds.add(id);
      nodes.push({
        id,
        type: 'resource',
        label: `${resource}/backups`,
        ts: event.sourceTs,
        eventIds: [event.id],
      });
      edges.push({ from, to: id, type: 'mutates', confidence: 'exact', eventIds: [event.id] });
    }
  }
  return { ...graph, nodes, edges };
}

function recoverability(
  nodeId: string,
  via: GraphEdge,
  byId: ReadonlyMap<string, Event>,
): { recoverable: boolean; reasons: RecoverabilityReason[] } {
  const reasons = new Set<RecoverabilityReason>();
  let backupsKept = false;
  if (nodeId.endsWith('/backups')) reasons.add('backups-deleted');
  for (const id of via.eventIds) {
    const event = byId.get(id);
    if (event === undefined) continue;
    const field = event.attrs['world.field'];
    const after = event.attrs['world.after'];
    if (
      asNumber(event.attrs['world.backupsDeleted']) > 0 ||
      (field === 'backupExists' && after === false)
    ) {
      reasons.add('backups-deleted');
    } else if (field === 'backupExists' && after === true) {
      backupsKept = true;
    }
    const operation = event.target?.operation ?? event.attrs['world.operation'];
    const name = typeof operation === 'string' ? operation : undefined;
    if (isIrreversible(name)) reasons.add('irreversible-operation');
    else if (isMutatingOperation(name)) reasons.add('reversible-operation');
  }
  if (via.type === 'mutates' && !reasons.has('irreversible-operation')) {
    reasons.add('reversible-operation');
  }
  if (reasons.size === 0) reasons.add('read-only');
  if (backupsKept) reasons.add('backup-exists');
  const recoverable =
    !reasons.has('backups-deleted') && (backupsKept || !reasons.has('irreversible-operation'));
  return { recoverable, reasons: [...reasons] };
}

// ARCHITECTURE §9: BFS over mutates/observes at confidence ≥ strong (weak only on request); waves are hops, so the ripple animates outward.
export function blastRadius(
  graph: CausalGraph,
  origin: string,
  events: readonly Event[],
  options: BlastOptions = {},
): BlastRadius {
  const minConfidence: Confidence = options.includeWeak === true ? 'weak' : 'strong';
  const byId = new Map(events.map((event) => [event.id, event]));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    if (edge.type !== 'mutates' && edge.type !== 'observes') continue;
    if (CONFIDENCE_RANK[edge.confidence] < CONFIDENCE_RANK[minConfidence]) continue;
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }
  const waves: BlastWave[] = [];
  const groups: Record<string, string[]> = {};
  const visited = new Set<string>([origin]);
  let frontier = [origin];
  let recoverable = true;
  for (let hop = 1; frontier.length > 0; hop += 1) {
    const resources: BlastResource[] = [];
    const next: string[] = [];
    for (const from of frontier) {
      for (const edge of outgoing.get(from) ?? []) {
        const node = nodes.get(edge.to);
        if (node?.type !== 'resource' || visited.has(node.id)) continue;
        visited.add(node.id);
        next.push(node.id);
        const [, system = '', ...rest] = node.id.split(':');
        const verdict = recoverability(node.id, edge, byId);
        recoverable = recoverable && verdict.recoverable;
        resources.push({
          nodeId: node.id,
          system,
          resource: rest.join(':'),
          via: edge,
          ...verdict,
        });
        (groups[system] ??= []).push(node.id);
      }
    }
    if (resources.length > 0) waves.push({ hop, resources });
    frontier = next;
  }
  return { origin, minConfidence, waves, groups, recoverable };
}
