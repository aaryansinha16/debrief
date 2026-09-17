import { type Actor, type Event, sortTimeline } from '@debrief/schema';

import {
  CONFIDENCE_RANK,
  type CausalGraph,
  type Confidence,
  type EdgeType,
  GRAPH_VERSION,
  type GraphEdge,
  type GraphNode,
  type NodeType,
} from './types.js';

const MUTATING_VERBS = [
  'delete',
  'remove',
  'drop',
  'destroy',
  'purge',
  'rotate',
  'create',
  'write',
  'put',
  'update',
  'set',
  'patch',
  'deploy',
  'restart',
  'revoke',
  'grant',
  'run',
  'exec',
  'kill',
  'scale',
  'move',
  'rename',
  'send',
  'post',
  'push',
  'merge',
  'truncate',
  'insert',
  'upsert',
];

export function isMutatingOperation(operation: string | undefined): boolean {
  const verb = (operation ?? '').toLowerCase();
  return MUTATING_VERBS.some((prefix) => verb.startsWith(prefix));
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const bareId = (actor: Pick<Actor, 'type' | 'id'>): string =>
  actor.id.startsWith(`${actor.type}:`) ? actor.id.slice(actor.type.length + 1) : actor.id;

const bareAgentId = (id: string): string => id.replace(/^(agent|subagent):/, '');

const principalNodeId = (principalId: string): string =>
  `principal:${bareId({ type: 'human', id: principalId })}`;

interface Attached {
  tool: GraphNode;
  confidence: Confidence;
}

interface Entry<T> {
  item: T;
  order: number;
}

class GraphBuilder {
  readonly nodes = new Map<string, Entry<GraphNode>>();
  readonly edges = new Map<string, Entry<GraphEdge>>();
  readonly principals: ReadonlySet<string>;
  cursor = Number.MAX_SAFE_INTEGER;
  readonly lastLlm = new Map<string, GraphNode>();
  private readonly toolBySpan = new Map<string, GraphNode>();
  private readonly toolByCallId = new Map<string, GraphNode>();
  private readonly spanOwner = new Map<string, GraphNode>();
  private readonly openTools: GraphNode[] = [];
  private readonly callers = new Map<string, string>();
  private readonly agentTypes = new Map<string, 'agent' | 'subagent'>();
  private readonly grants = new Map<string, GraphNode>();

  constructor(events: readonly Event[]) {
    const principals = new Set<string>();
    for (const event of events) {
      if (event.authority !== undefined) principals.add(event.authority.principalId);
      if (event.kind === 'principal.session') principals.add(event.actor.id);
      const { actor } = event;
      if (actor.type === 'agent' || actor.type === 'subagent') {
        const bare = bareId(actor);
        if (this.agentTypes.get(bare) !== 'subagent') this.agentTypes.set(bare, actor.type);
      }
    }
    this.principals = principals;
  }

  node(id: string, type: NodeType, label: string, event: Event, attach = true): GraphNode {
    let entry = this.nodes.get(id);
    if (entry === undefined) {
      entry = {
        item: { id, type, label, ts: event.sourceTs, eventIds: [] },
        order: Number.MAX_SAFE_INTEGER,
      };
      this.nodes.set(id, entry);
    }
    if (attach && !entry.item.eventIds.includes(event.id)) {
      entry.item.eventIds.push(event.id);
      entry.order = Math.min(entry.order, this.cursor);
    }
    return entry.item;
  }

  edge(from: GraphNode, to: GraphNode, type: EdgeType, confidence: Confidence, event: Event): void {
    const key = `${from.id}\t${to.id}\t${type}`;
    let entry = this.edges.get(key);
    if (entry === undefined) {
      entry = {
        item: { from: from.id, to: to.id, type, confidence, eventIds: [] },
        order: this.cursor,
      };
      this.edges.set(key, entry);
      if (type === 'calls' && !this.callers.has(to.id)) this.callers.set(to.id, from.id);
    }
    const edge = entry.item;
    if (CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK[edge.confidence])
      edge.confidence = confidence;
    edge.eventIds.push(event.id);
    entry.order = Math.min(entry.order, this.cursor);
  }

  lookup(id: string): GraphNode | undefined {
    return this.nodes.get(id)?.item;
  }

  actorNode(event: Event, attach = false): GraphNode {
    const actor = event.actor;
    const label = actor.name ?? bareId(actor);
    switch (actor.type) {
      case 'human':
        return this.principals.has(actor.id)
          ? this.node(principalNodeId(actor.id), 'principal', label, event, attach)
          : this.node(`human:${bareId(actor)}`, 'human', label, event, attach);
      case 'agent':
      case 'subagent':
        return this.node(`${actor.type}:${bareId(actor)}`, actor.type, label, event, attach);
      case 'system': {
        const system = event.target?.system ?? bareId(actor);
        return this.node(`system:${system}`, 'system', label, event, attach);
      }
    }
  }

  agentNodeById(id: string, event: Event): GraphNode {
    const bare = bareAgentId(id);
    const type = this.agentTypes.get(bare) ?? 'agent';
    return this.node(`${type}:${bare}`, type, bare, event, false);
  }

  principalNode(principalId: string, event: Event): GraphNode {
    const id = principalNodeId(principalId);
    return this.node(id, 'principal', id.slice('principal:'.length), event, false);
  }

  grantNode(event: Event): GraphNode {
    const authority = event.authority;
    const key = authority?.tokenRef ?? authority?.grantId ?? event.id;
    const label = asString(event.attrs['delegation.token.label']) ?? key;
    const grant = this.node(`grant:${key}`, 'grant', label, event);
    for (const ref of [authority?.tokenRef, authority?.grantId]) {
      if (ref !== undefined && !this.grants.has(ref)) this.grants.set(ref, grant);
    }
    return grant;
  }

  findGrant(event: Event): GraphNode | undefined {
    const authority = event.authority;
    if (authority === undefined) return undefined;
    for (const ref of [authority.tokenRef, authority.grantId]) {
      const grant = ref === undefined ? undefined : this.grants.get(ref);
      if (grant !== undefined) return grant;
    }
    return undefined;
  }

  resourceNode(event: Event): GraphNode | undefined {
    const target = event.target;
    if (target?.resource === undefined) return undefined;
    const id = `resource:${target.system}:${target.resource}`;
    return this.node(id, 'resource', target.resource, event);
  }

  systemNode(event: Event): GraphNode | undefined {
    const system = event.target?.system;
    return system === undefined
      ? undefined
      : this.node(`system:${system}`, 'system', system, event);
  }

  toolNode(event: Event, label: string): GraphNode {
    const tool = this.node(`tool:${event.id}`, 'tool', label, event);
    this.indexTool(tool, event);
    this.openTools.push(tool);
    return tool;
  }

  indexTool(tool: GraphNode, event: Event): void {
    if (event.spanId !== undefined) this.toolBySpan.set(event.spanId, tool);
    const callId = asString(event.attrs['gen_ai.tool.call.id']);
    if (callId !== undefined) this.toolByCallId.set(callId, tool);
  }

  // ARCHITECTURE §9: by call id, then by span, then by adjacency (latest open call by the same actor).
  attachTool(event: Event, adjacency: boolean): Attached | undefined {
    const callId = asString(event.attrs['gen_ai.tool.call.id']);
    const byCall = callId === undefined ? undefined : this.toolByCallId.get(callId);
    if (byCall !== undefined) return { tool: this.attach(byCall, event), confidence: 'exact' };
    for (const span of [event.spanId, event.parentSpanId]) {
      const bySpan = span === undefined ? undefined : this.toolBySpan.get(span);
      if (bySpan !== undefined) return { tool: this.attach(bySpan, event), confidence: 'exact' };
    }
    if (!adjacency) return undefined;
    const actorId = this.actorNode(event).id;
    for (let index = this.openTools.length - 1; index >= 0; index -= 1) {
      const candidate = this.openTools[index];
      if (candidate !== undefined && this.callers.get(candidate.id) === actorId) {
        return { tool: this.attach(candidate, event), confidence: 'strong' };
      }
    }
    return undefined;
  }

  private attach(tool: GraphNode, event: Event): GraphNode {
    if (event.kind === 'tool.result' || event.kind === 'mcp.response') {
      const index = this.openTools.indexOf(tool);
      if (index >= 0) this.openTools.splice(index, 1);
    }
    return this.node(tool.id, tool.type, tool.label, event);
  }

  ownerOfSpan(spanId: string | undefined): GraphNode | undefined {
    return spanId === undefined ? undefined : this.spanOwner.get(spanId);
  }

  claimSpan(event: Event, owner: GraphNode): void {
    if (event.spanId !== undefined && !this.spanOwner.has(event.spanId)) {
      this.spanOwner.set(event.spanId, owner);
    }
  }
}

function authorize(b: GraphBuilder, tool: GraphNode, event: Event): void {
  const grant = b.findGrant(event);
  if (grant !== undefined) {
    b.edge(tool, grant, 'authorized_by', 'exact', event);
    return;
  }
  const principalId = event.authority?.principalId;
  if (principalId !== undefined) {
    b.edge(tool, b.principalNode(principalId, event), 'authorized_by', 'strong', event);
  }
}

function foldToolCall(b: GraphBuilder, event: Event): void {
  const agent = b.actorNode(event);
  const name = asString(event.attrs['gen_ai.tool.name']) ?? event.target?.operation ?? 'tool';
  const tool = b.toolNode(event, name);
  b.claimSpan(event, agent);
  b.edge(agent, tool, 'calls', 'exact', event);
  authorize(b, tool, event);
  const resource = b.resourceNode(event);
  if (resource !== undefined) {
    const type = isMutatingOperation(event.target?.operation) ? 'mutates' : 'observes';
    b.edge(tool, resource, type, 'strong', event);
  }
}

function foldGrant(b: GraphBuilder, event: Event): void {
  const grantor = b.actorNode(event, true);
  const grant = b.grantNode(event);
  if (event.kind === 'delegation.revoke') return;
  b.edge(grantor, grant, 'delegates_to', 'exact', event);
  const to = asString(event.attrs['delegation.to']);
  if (to !== undefined) b.edge(grant, b.agentNodeById(to, event), 'delegates_to', 'exact', event);
  const principalId = event.authority?.principalId;
  if (principalId !== undefined && grantor.id !== principalNodeId(principalId)) {
    b.edge(grant, b.principalNode(principalId, event), 'authorized_by', 'exact', event);
  }
}

function fold(b: GraphBuilder, event: Event): void {
  switch (event.kind) {
    case 'tool.call':
    case 'delegation.grant':
    case 'delegation.revoke':
      return;
    case 'principal.session':
    case 'agent.plan': {
      b.actorNode(event, true);
      return;
    }
    case 'agent.invoke': {
      const agent = b.actorNode(event, true);
      b.claimSpan(event, agent);
      const parent = b.ownerOfSpan(event.parentSpanId);
      if (parent !== undefined && parent.id !== agent.id) {
        b.edge(parent, agent, 'delegates_to', 'exact', event);
        return;
      }
      const principalId = event.authority?.principalId;
      if (principalId !== undefined) {
        b.edge(b.principalNode(principalId, event), agent, 'triggers', 'exact', event);
        return;
      }
      const [only] = b.principals;
      if (only !== undefined && b.principals.size === 1) {
        b.edge(b.principalNode(only, event), agent, 'triggers', 'strong', event);
      }
      return;
    }
    case 'llm.call': {
      const agent = b.actorNode(event);
      const model =
        asString(event.attrs['gen_ai.response.model']) ??
        asString(event.attrs['gen_ai.request.model']) ??
        'llm';
      const llm = b.node(`llm:${event.id}`, 'llm', model, event);
      b.claimSpan(event, agent);
      b.edge(agent, llm, 'calls', 'exact', event);
      b.edge(llm, agent, 'returns', 'exact', event);
      return;
    }
    case 'tool.result': {
      const attached = b.attachTool(event, true);
      if (attached === undefined) {
        b.actorNode(event, true);
        return;
      }
      b.edge(attached.tool, b.actorNode(event), 'returns', attached.confidence, event);
      return;
    }
    case 'mcp.request': {
      const agent = b.actorNode(event);
      const attached = b.attachTool(event, false);
      let tool: GraphNode;
      if (attached === undefined) {
        const label =
          asString(event.attrs['gen_ai.tool.name']) ??
          asString(event.attrs['mcp.method.name']) ??
          'mcp';
        tool = b.toolNode(event, label);
        b.edge(agent, tool, 'calls', 'exact', event);
      } else {
        tool = attached.tool;
        b.indexTool(tool, event);
      }
      b.claimSpan(event, agent);
      authorize(b, tool, event);
      const system = b.systemNode(event);
      if (system !== undefined) b.edge(tool, system, 'calls', 'exact', event);
      return;
    }
    case 'mcp.response': {
      const attached = b.attachTool(event, true);
      if (attached === undefined) {
        b.actorNode(event, true);
        return;
      }
      const system = b.systemNode(event);
      if (system !== undefined)
        b.edge(system, attached.tool, 'returns', attached.confidence, event);
      return;
    }
    case 'world.change': {
      const system = b.actorNode(event, true);
      const resource = b.resourceNode(event);
      if (resource !== undefined) b.edge(system, resource, 'mutates', 'exact', event);
      return;
    }
    case 'policy.decision': {
      const rule =
        asString(event.attrs['policy.rule.id']) ??
        asString(event.attrs['policy.effect']) ??
        'policy';
      const policy = b.node(`policy:${event.id}`, 'policy', rule, event);
      const attached = b.attachTool(event, false);
      if (attached !== undefined) b.edge(policy, attached.tool, 'observes', 'exact', event);
      return;
    }
    case 'human.approval': {
      const human = b.actorNode(event, true);
      const attached = b.attachTool(event, true);
      if (attached !== undefined) {
        b.edge(attached.tool, human, 'authorized_by', attached.confidence, event);
      }
      return;
    }
    case 'agent.message': {
      const from = b.actorNode(event, true);
      const to = asString(event.attrs['agent.message.to']);
      if (to !== undefined) b.edge(from, b.agentNodeById(to, event), 'messages', 'exact', event);
      return;
    }
    case 'error': {
      const attached = b.attachTool(event, false);
      if (attached === undefined) b.actorNode(event, true);
      return;
    }
  }
}

// The LLM turn preceding a tool call by the same actor decided it: adjacency, hence strong.
function linkTrigger(b: GraphBuilder, event: Event): void {
  const actorId = b.actorNode(event).id;
  const llm = b.lookup(`llm:${event.id}`);
  if (llm !== undefined) {
    b.lastLlm.set(actorId, llm);
    return;
  }
  const tool = b.lookup(`tool:${event.id}`);
  const trigger = b.lastLlm.get(actorId);
  if (tool !== undefined && trigger !== undefined)
    b.edge(trigger, tool, 'triggers', 'strong', event);
}

export interface BuildGraphOptions {
  runId?: string;
}

// ARCHITECTURE §9: pure, deterministic, order-independent; only the chosen run's events contribute.
export function buildGraph(events: readonly Event[], options: BuildGraphOptions = {}): CausalGraph {
  const bySeq = [...events].sort((a, b) => a.seq - b.seq);
  const runId = options.runId ?? bySeq[0]?.runId ?? '';
  const ordered = sortTimeline(bySeq.filter((event) => event.runId === runId));
  const b = new GraphBuilder(ordered);
  const pass = (
    kinds: readonly Event['kind'][] | undefined,
    step: (event: Event) => void,
  ): void => {
    ordered.forEach((event, index) => {
      if (kinds === undefined || kinds.includes(event.kind)) {
        b.cursor = index;
        step(event);
      }
    });
  };
  pass(['delegation.grant', 'delegation.revoke'], (event) => {
    foldGrant(b, event);
  });
  pass(['tool.call'], (event) => {
    foldToolCall(b, event);
  });
  pass(undefined, (event) => {
    fold(b, event);
  });
  pass(undefined, (event) => {
    linkTrigger(b, event);
  });
  for (const { item, order } of b.nodes.values()) {
    const earliest = ordered[order];
    if (earliest !== undefined) item.ts = earliest.sourceTs;
  }
  const edgeKey = (edge: GraphEdge): string => `${edge.from}\t${edge.to}\t${edge.type}`;
  const nodes = [...b.nodes.values()]
    .sort((x, y) => x.order - y.order || (x.item.id < y.item.id ? -1 : 1))
    .map((entry) => entry.item);
  const edges = [...b.edges.values()]
    .sort((x, y) => x.order - y.order || (edgeKey(x.item) < edgeKey(y.item) ? -1 : 1))
    .map((entry) => entry.item);
  return { runId, version: GRAPH_VERSION, nodes, edges };
}
