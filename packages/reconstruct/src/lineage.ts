import type { Event, Target } from '@debrief/schema';

import { type TimelineKey, compareKeys, timelineKey } from './timeline.js';
import type { CausalGraph, GraphEdge, GraphNode, NodeType } from './types.js';

export interface HopAuthority {
  grantNodeId: string;
  principalId?: string;
  grantId?: string;
  tokenRef?: string;
  scope: string[];
  permissions: string[];
  eventIds: string[];
}

export type MismatchKind = 'permissions-exceed-scope' | 'target-outside-scope';

export interface ScopeMismatch {
  kind: MismatchKind;
  severity: 'minor' | 'major';
  scope: string[];
  permissions: string[];
  excess: string[];
  target?: string;
}

export interface LineageHop {
  nodeId: string;
  type: NodeType;
  label: string;
  authority?: HopAuthority;
  scopeMismatch?: ScopeMismatch[];
}

export interface LineageAction {
  nodeId: string;
  label: string;
  target?: Target;
  descriptor?: string;
}

export interface AuthorityLineage {
  origin: string;
  action: LineageAction;
  hops: LineageHop[];
  principalId?: string;
  complete: boolean;
  authorityObserved: boolean;
  mismatches: number;
}

const segments = (value: string): string[] => value.split(':');

// `staging:credentials` covers `staging:credentials:rotate`; `staging:*` covers anything under staging.
export function scopeCovers(scope: string, permission: string): boolean {
  const s = segments(scope);
  const p = segments(permission);
  for (let index = 0; index < s.length; index += 1) {
    if (s[index] === '*') return true;
    if (s[index] !== p[index]) return false;
  }
  return true;
}

export function permissionsExceedingScope(
  scope: readonly string[],
  permissions: readonly string[],
): string[] {
  return permissions.filter((permission) => !scope.some((entry) => scopeCovers(entry, permission)));
}

// production:volumes:deleteVolume — environment, resource class (path segment before the id), operation.
export function targetDescriptor(target: Target): string | undefined {
  const path = target.resource?.split('/') ?? [];
  const resourceClass = path.length >= 2 ? path[path.length - 2] : path[0];
  if (target.environment === undefined && resourceClass === undefined) return undefined;
  return [target.environment ?? 'unknown', resourceClass ?? '*', target.operation ?? '*'].join(':');
}

const isMajor = (scope: readonly string[], excess: readonly string[]): boolean =>
  excess.some(
    (permission) =>
      permission.includes('*') ||
      !scope.some((entry) => segments(entry)[0] === segments(permission)[0]),
  );

function mismatchesFor(authority: HopAuthority, descriptor: string | undefined): ScopeMismatch[] {
  const found: ScopeMismatch[] = [];
  const excess = permissionsExceedingScope(authority.scope, authority.permissions);
  if (excess.length > 0) {
    found.push({
      kind: 'permissions-exceed-scope',
      severity: isMajor(authority.scope, excess) ? 'major' : 'minor',
      scope: authority.scope,
      permissions: authority.permissions,
      excess,
    });
  }
  if (descriptor !== undefined && authority.scope.length > 0) {
    if (!authority.scope.some((entry) => scopeCovers(entry, descriptor))) {
      found.push({
        kind: 'target-outside-scope',
        severity: 'major',
        scope: authority.scope,
        permissions: authority.permissions,
        excess: [descriptor],
        target: descriptor,
      });
    }
  }
  return found;
}

class Lineage {
  private readonly nodes: Map<string, GraphNode>;
  private readonly byId: Map<string, Event>;

  constructor(
    private readonly graph: CausalGraph,
    events: readonly Event[],
  ) {
    this.nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    this.byId = new Map(events.map((event) => [event.id, event]));
  }

  node(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  edges(filter: (edge: GraphEdge) => boolean): GraphEdge[] {
    return this.graph.edges.filter(filter);
  }

  authorityOf(grant: GraphNode): HopAuthority {
    const authority: HopAuthority = {
      grantNodeId: grant.id,
      scope: [],
      permissions: [],
      eventIds: [...grant.eventIds],
    };
    for (const id of grant.eventIds) {
      const event = this.byId.get(id);
      if (event?.authority === undefined) continue;
      authority.principalId = event.authority.principalId;
      if (event.authority.grantId !== undefined) authority.grantId = event.authority.grantId;
      if (event.authority.tokenRef !== undefined) authority.tokenRef = event.authority.tokenRef;
      authority.scope = [...(event.authority.scope ?? authority.scope)];
      authority.permissions = [...(event.authority.permissions ?? authority.permissions)];
    }
    return authority;
  }

  grantor(grant: GraphNode): GraphNode | undefined {
    const edge = this.edges((e) => e.to === grant.id && e.type === 'delegates_to')[0];
    return edge === undefined ? undefined : this.node(edge.from);
  }

  grantee(grant: GraphNode): GraphNode | undefined {
    const edge = this.edges((e) => e.from === grant.id && e.type === 'delegates_to')[0];
    return edge === undefined ? undefined : this.node(edge.to);
  }

  issuer(grant: GraphNode): GraphNode | undefined {
    const edge = this.edges((e) => e.from === grant.id && e.type === 'authorized_by')[0];
    return edge === undefined ? undefined : this.node(edge.to);
  }

  timeOf(node: GraphNode): TimelineKey | undefined {
    const keys = node.eventIds
      .map((id) => this.byId.get(id))
      .filter((event): event is Event => event !== undefined)
      .map(timelineKey)
      .sort(compareKeys);
    return keys[0];
  }

  // The latest grant the actor held before the action; the earliest one when none predates it.
  grantInto(
    actor: GraphNode,
    exclude: ReadonlySet<string>,
    before: TimelineKey | undefined,
  ): GraphNode | undefined {
    const candidates = this.edges(
      (e) => e.to === actor.id && e.type === 'delegates_to' && !exclude.has(e.from),
    )
      .map((e) => this.node(e.from))
      .filter((node): node is GraphNode => node?.type === 'grant')
      .map((grant) => ({ grant, at: this.timeOf(grant) }))
      .sort((a, b) => compareKeys(a.at ?? [0, 0, 0], b.at ?? [0, 0, 0]));
    const prior = candidates.filter(
      (c) => before === undefined || c.at === undefined || compareKeys(c.at, before) <= 0,
    );
    return (prior.at(-1) ?? candidates[0])?.grant;
  }

  parentOf(actor: GraphNode): GraphNode | undefined {
    const edge = this.edges(
      (e) => e.to === actor.id && e.type === 'delegates_to' && this.node(e.from)?.type !== 'grant',
    )[0];
    return edge === undefined ? undefined : this.node(edge.from);
  }

  caller(tool: GraphNode): GraphNode | undefined {
    const edge = this.edges((e) => e.to === tool.id && e.type === 'calls')[0];
    return edge === undefined ? undefined : this.node(edge.from);
  }

  actionGrant(origin: GraphNode): GraphNode | undefined {
    const grants = this.edges((e) => e.from === origin.id && e.type === 'authorized_by')
      .map((e) => this.node(e.to))
      .filter((node): node is GraphNode => node?.type === 'grant');
    return grants.at(-1);
  }

  target(origin: GraphNode): Target | undefined {
    const worldTargets = this.edges(
      (e) => e.from === origin.id && (e.type === 'mutates' || e.type === 'observes'),
    )
      .flatMap((e) => e.eventIds)
      .map((id) => this.byId.get(id)?.target)
      .filter((target): target is Target => target?.resource !== undefined);
    if (worldTargets.length > 0) return worldTargets[0];
    for (const id of origin.eventIds) {
      const target = this.byId.get(id)?.target;
      if (target?.resource !== undefined || target?.environment !== undefined) return target;
    }
    return undefined;
  }
}

const hopOf = (node: GraphNode, authority?: HopAuthority, descriptor?: string): LineageHop => {
  const hop: LineageHop = { nodeId: node.id, type: node.type, label: node.label };
  if (authority !== undefined) {
    hop.authority = authority;
    const mismatches = mismatchesFor(authority, descriptor);
    if (mismatches.length > 0) hop.scopeMismatch = mismatches;
  }
  return hop;
};

// ARCHITECTURE §9: hops are authority holders, root first: the principal, each delegate with the token it was handed, and any token an actor adopted on its own.
export function authorityLineage(
  graph: CausalGraph,
  originId: string,
  events: readonly Event[],
): AuthorityLineage {
  const l = new Lineage(graph, events);
  const origin = l.node(originId);
  if (origin === undefined) {
    return {
      origin: originId,
      action: { nodeId: originId, label: originId },
      hops: [],
      complete: false,
      authorityObserved: false,
      mismatches: 0,
    };
  }
  const target = l.target(origin);
  const descriptor = target === undefined ? undefined : targetDescriptor(target);
  const action: LineageAction = { nodeId: origin.id, label: origin.label };
  if (target !== undefined) action.target = target;
  if (descriptor !== undefined) action.descriptor = descriptor;
  const hops: LineageHop[] = [];
  const seen = new Set<string>();
  let actor: GraphNode | undefined = origin.type === 'tool' ? l.caller(origin) : origin;
  let grant: GraphNode | undefined = origin.type === 'tool' ? l.actionGrant(origin) : undefined;
  const authorityObserved = grant !== undefined;
  const actionTime = l.timeOf(origin);
  let actionDescriptor = descriptor;
  for (;;) {
    if (grant === undefined && actor !== undefined && !seen.has(actor.id)) {
      grant = l.grantInto(actor, seen, actionTime);
    }
    if (grant !== undefined) {
      seen.add(grant.id);
      const grantor = l.grantor(grant);
      const holder = l.grantee(grant) ?? actor;
      const authority = l.authorityOf(grant);
      const selfAdopted = grantor !== undefined && grantor.id === holder?.id;
      if (holder !== undefined && !selfAdopted) {
        seen.add(holder.id);
        hops.unshift(hopOf(holder, authority, actionDescriptor));
      } else {
        hops.unshift(hopOf(grant, authority, actionDescriptor));
      }
      actionDescriptor = undefined;
      actor = grantor ?? l.issuer(grant);
      grant = undefined;
      if (actor === undefined) break;
      continue;
    }
    if (actor === undefined || seen.has(actor.id)) break;
    seen.add(actor.id);
    hops.unshift(hopOf(actor));
    if (actor.type === 'principal' || actor.type === 'human') break;
    const parent = l.parentOf(actor);
    if (parent === undefined) break;
    actor = parent;
  }
  const root = hops[0];
  const rooted = root !== undefined && (root.type === 'principal' || root.type === 'human');
  const lineage: AuthorityLineage = {
    origin: originId,
    action,
    hops,
    complete: rooted,
    authorityObserved,
    mismatches: hops.reduce((sum, hop) => sum + (hop.scopeMismatch?.length ?? 0), 0),
  };
  if (rooted) lineage.principalId = root.nodeId;
  return lineage;
}
