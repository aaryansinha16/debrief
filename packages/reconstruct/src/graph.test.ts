import type { Event } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import golden from '../__golden__/nine-seconds.graph.json';
import { DEMO_PROXY_RUN_ID, DEMO_RUN_ID, demoRunFixture } from './__fixtures__/nine-seconds.js';
import { buildGraph, isMutatingOperation } from './graph.js';
import { sortTimeline, timelineKey } from './timeline.js';
import { type CausalGraph, GRAPH_VERSION, type GraphEdge } from './types.js';

const ZERO = '0'.repeat(64);
const AGENT = { type: 'agent', id: 'agent:worker', name: 'worker' } as const;
const HUMAN = { type: 'human', id: 'human:pat', name: 'Pat' } as const;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ulid = (seq: number): string =>
  `01J8ZK5R4M2X6P9Q3V7W1Y5N${ALPHABET[Math.floor(seq / 32)] ?? '0'}${ALPHABET[seq % 32] ?? '0'}`;
const at = (seq: number): string =>
  new Date(Date.UTC(2026, 8, 17, 0, 0, 0) + seq * 1000).toISOString();

const ev = (seq: number, patch: Partial<Event> & Pick<Event, 'kind'>): Event => ({
  id: ulid(seq),
  tenantId: 't',
  seq,
  ts: at(seq),
  sourceTs: at(seq),
  source: 'api',
  provenance: 'reported',
  runId: 'run-x',
  actor: AGENT,
  attrs: {},
  prevHash: ZERO,
  hash: ZERO,
  ...patch,
});

const edgesOf = (graph: CausalGraph, type: GraphEdge['type']): GraphEdge[] =>
  graph.edges.filter((edge) => edge.type === type);
const find = (
  graph: CausalGraph,
  from: string,
  to: string,
  type: GraphEdge['type'],
): GraphEdge | undefined =>
  graph.edges.find((edge) => edge.from === from && edge.to === to && edge.type === type);
const countBy = <T>(items: readonly T[], key: (item: T) => string): Record<string, number> =>
  items.reduce<Record<string, number>>((acc, item) => {
    acc[key(item)] = (acc[key(item)] ?? 0) + 1;
    return acc;
  }, {});

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let index = out.length - 1; index > 0; index -= 1) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    const swap = state % (index + 1);
    [out[index], out[swap]] = [out[swap]!, out[index]!];
  }
  return out;
}

function assertWellFormed(graph: CausalGraph): void {
  const ids = new Set(graph.nodes.map((node) => node.id));
  expect(ids.size).toBe(graph.nodes.length);
  for (const edge of graph.edges) {
    expect(ids.has(edge.from), edge.from).toBe(true);
    expect(ids.has(edge.to), edge.to).toBe(true);
    expect(edge.eventIds.length).toBeGreaterThan(0);
  }
  expect(graph.version).toBe(GRAPH_VERSION);
}

describe('buildGraph on the demo run', () => {
  const graph = buildGraph(demoRunFixture(), { runId: DEMO_RUN_ID });

  it('matches the golden graph', () => {
    expect(graph).toEqual(golden);
    assertWellFormed(graph);
  });

  it('has one node per actor, grant, llm turn, tool call, system and resource', () => {
    expect(countBy(graph.nodes, (node) => node.type)).toEqual({
      principal: 1,
      agent: 1,
      grant: 2,
      llm: 9,
      tool: 8,
      system: 2,
      resource: 2,
    });
    const tools = graph.nodes.filter((node) => node.type === 'tool');
    expect(tools.map((node) => node.label)).toEqual([
      'listVolumes',
      'rotateCredential',
      'deleteVolume',
      'readFile',
      'readFile',
      'readFile',
      'listVolumes',
      'deleteVolume',
    ]);
    const byId = new Map(demoRunFixture().map((event) => [event.id, event]));
    for (const tool of tools) {
      expect(tool.eventIds.map((id) => byId.get(id)?.kind).sort()).toEqual([
        'mcp.request',
        'mcp.response',
        'tool.call',
        'tool.result',
      ]);
    }
    expect(graph.nodes.find((node) => node.type === 'agent')).toMatchObject({
      id: 'agent:coding-agent',
      label: 'coding-agent',
    });
    expect(graph.nodes.filter((node) => node.type === 'grant').map((node) => node.id)).toEqual([
      'grant:tok-stg-7f3a',
      'grant:tok-acct-9c1d',
    ]);
  });

  it('wires calls, returns, triggers, delegation and observed mutations', () => {
    expect(countBy(graph.edges, (edge) => `${edge.type}/${edge.confidence}`)).toEqual({
      'calls/exact': 25,
      'returns/exact': 25,
      'triggers/strong': 9,
      'delegates_to/exact': 4,
      'authorized_by/exact': 1,
      'mutates/exact': 2,
    });
    expect(find(graph, 'principal:aaryan', 'agent:coding-agent', 'triggers')).toBeDefined();
    expect(find(graph, 'principal:aaryan', 'grant:tok-stg-7f3a', 'delegates_to')).toBeDefined();
    expect(find(graph, 'grant:tok-stg-7f3a', 'agent:coding-agent', 'delegates_to')).toBeDefined();
    expect(find(graph, 'agent:coding-agent', 'grant:tok-acct-9c1d', 'delegates_to')).toBeDefined();
    expect(find(graph, 'grant:tok-acct-9c1d', 'principal:aaryan', 'authorized_by')).toBeDefined();
    const mutations = edgesOf(graph, 'mutates');
    expect(mutations.map((edge) => edge.to)).toEqual([
      'resource:orbital:projects/nova/environments/staging/credentials/DATABASE_URL',
      'resource:orbital:projects/nova/volumes/vol-prod-01',
    ]);
    expect(mutations.every((edge) => edge.from === 'system:orbital')).toBe(true);
    const triggered = edgesOf(graph, 'triggers').filter((edge) => edge.from.startsWith('llm:'));
    expect(new Set(triggered.map((edge) => edge.to)).size).toBe(8);
  });

  it('defaults to the run of the lowest seq and ignores the other run', () => {
    const fixture = demoRunFixture();
    expect(buildGraph(fixture).runId).toBe(DEMO_RUN_ID);
    expect(buildGraph(fixture)).toEqual(graph);
    const alone = fixture.filter((event) => event.runId === DEMO_RUN_ID);
    expect(buildGraph(alone)).toEqual(graph);
    const decoy = fixture.map((event, index) => ({
      ...event,
      id: ulid(200 + index),
      seq: 1000 + index,
      runId: 'run-decoy',
    }));
    expect(buildGraph([...fixture, ...decoy], { runId: DEMO_RUN_ID })).toEqual(graph);
    expect(buildGraph([...decoy, ...fixture], { runId: DEMO_RUN_ID })).toEqual(graph);
  });

  it('is deterministic and independent of input order', () => {
    expect(buildGraph(demoRunFixture(), { runId: DEMO_RUN_ID })).toEqual(graph);
    expect(buildGraph([...demoRunFixture()].reverse(), { runId: DEMO_RUN_ID })).toEqual(graph);
    for (const seed of [1, 7, 42]) {
      expect(buildGraph(shuffle(demoRunFixture(), seed), { runId: DEMO_RUN_ID })).toEqual(graph);
    }
  });

  it('builds the proxy session run from mcp events alone', () => {
    const proxy = buildGraph(demoRunFixture(), { runId: DEMO_PROXY_RUN_ID });
    assertWellFormed(proxy);
    expect(proxy.nodes.map((node) => [node.type, node.label, node.eventIds.length])).toEqual([
      ['tool', 'initialize', 2],
      ['agent', 'coding-agent', 0],
    ]);
    expect(proxy.edges.map((edge) => edge.type)).toEqual(['calls']);
  });

  it('returns an empty graph for no events', () => {
    expect(buildGraph([])).toEqual({ runId: '', version: GRAPH_VERSION, nodes: [], edges: [] });
    expect(buildGraph(demoRunFixture(), { runId: 'nope' })).toEqual({
      runId: 'nope',
      version: GRAPH_VERSION,
      nodes: [],
      edges: [],
    });
  });
});

describe('tool result attachment', () => {
  it('attaches by call id, then span, then adjacency, and upgrades confidence', () => {
    const graph = buildGraph([
      ev(0, { kind: 'tool.call', spanId: 's1', attrs: { 'gen_ai.tool.call.id': 'c1' } }),
      ev(1, { kind: 'tool.call', spanId: 's2', target: { system: 'x', operation: 'getThing' } }),
      ev(2, { kind: 'tool.call', spanId: 's3' }),
      ev(3, { kind: 'tool.result', attrs: { 'gen_ai.tool.call.id': 'c1' } }),
      ev(4, { kind: 'tool.result', spanId: 's2' }),
      ev(5, { kind: 'tool.result' }),
      ev(6, { kind: 'tool.result', actor: { type: 'agent', id: 'other' } }),
      ev(7, { kind: 'tool.result' }),
    ]);
    assertWellFormed(graph);
    const returns = edgesOf(graph, 'returns');
    expect(returns.map((edge) => [edge.from, edge.confidence])).toEqual([
      [`tool:${ulid(0)}`, 'exact'],
      [`tool:${ulid(1)}`, 'exact'],
      [`tool:${ulid(2)}`, 'strong'],
    ]);
    expect(graph.nodes.map((node) => node.label)).toEqual([
      'tool',
      'getThing',
      'tool',
      'other',
      'worker',
    ]);
    expect(graph.nodes.find((node) => node.id === 'agent:other')?.eventIds).toEqual([ulid(6)]);
    expect(graph.nodes.find((node) => node.id === 'agent:worker')?.eventIds).toEqual([ulid(7)]);
  });

  it('upgrades an adjacency edge to exact when a later result carries the call id', () => {
    const graph = buildGraph([
      ev(0, { kind: 'tool.call', spanId: 's1', attrs: { 'gen_ai.tool.call.id': 'c1' } }),
      ev(1, { kind: 'tool.result' }),
      ev(2, { kind: 'tool.result', attrs: { 'gen_ai.tool.call.id': 'c1' } }),
    ]);
    expect(edgesOf(graph, 'returns')).toEqual([
      {
        from: `tool:${ulid(0)}`,
        to: 'agent:worker',
        type: 'returns',
        confidence: 'exact',
        eventIds: [ulid(1), ulid(2)],
      },
    ]);
  });
});

describe('authority, resources and mutations', () => {
  it('links tool calls to grants, principals and resources', () => {
    const grant = { principalId: 'human:pat', tokenRef: 'tok-1', grantId: 'g-1' };
    const graph = buildGraph([
      ev(0, {
        kind: 'delegation.grant',
        actor: HUMAN,
        authority: grant,
        attrs: { 'delegation.to': 'agent:worker' },
      }),
      ev(1, {
        kind: 'tool.call',
        authority: grant,
        target: { system: 'orbital', resource: 'projects/p/volumes/v', operation: 'deleteVolume' },
      }),
      ev(2, {
        kind: 'tool.call',
        authority: { principalId: 'human:pat', grantId: 'g-1' },
        target: { system: 'orbital', resource: 'projects/p/volumes/v', operation: 'listVolumes' },
      }),
      ev(3, { kind: 'tool.call', authority: { principalId: 'human:zed' } }),
      ev(4, { kind: 'tool.call', authority: { principalId: 'human:pat', tokenRef: 'unknown' } }),
    ]);
    assertWellFormed(graph);
    expect(find(graph, `tool:${ulid(1)}`, 'grant:tok-1', 'authorized_by')?.confidence).toBe(
      'exact',
    );
    expect(find(graph, `tool:${ulid(2)}`, 'grant:tok-1', 'authorized_by')?.confidence).toBe(
      'exact',
    );
    expect(find(graph, `tool:${ulid(3)}`, 'principal:zed', 'authorized_by')?.confidence).toBe(
      'strong',
    );
    expect(find(graph, `tool:${ulid(4)}`, 'principal:pat', 'authorized_by')?.confidence).toBe(
      'strong',
    );
    expect(
      find(graph, `tool:${ulid(1)}`, 'resource:orbital:projects/p/volumes/v', 'mutates')
        ?.confidence,
    ).toBe('strong');
    expect(
      find(graph, `tool:${ulid(2)}`, 'resource:orbital:projects/p/volumes/v', 'observes')
        ?.confidence,
    ).toBe('strong');
    expect(graph.nodes.find((node) => node.id === 'principal:zed')?.eventIds).toEqual([]);
    expect(graph.nodes.at(-1)?.id).toBe('principal:zed');
  });

  it('classifies operations by verb', () => {
    expect(isMutatingOperation('DeleteVolume')).toBe(true);
    expect(isMutatingOperation('rotateCredential')).toBe(true);
    expect(isMutatingOperation('listVolumes')).toBe(false);
    expect(isMutatingOperation(undefined)).toBe(false);
  });

  it('records grants without a grantee, revocations and self-issued grants', () => {
    const graph = buildGraph([
      ev(0, { kind: 'delegation.grant', actor: HUMAN }),
      ev(1, { kind: 'delegation.revoke', actor: HUMAN }),
      ev(2, {
        kind: 'delegation.grant',
        actor: HUMAN,
        authority: { principalId: 'human:pat', grantId: 'g' },
      }),
      ev(3, { kind: 'delegation.grant', actor: HUMAN, attrs: { 'delegation.to': 'agent:ghost' } }),
    ]);
    assertWellFormed(graph);
    expect(graph.nodes.map((node) => node.id)).toEqual([
      `grant:${ulid(0)}`,
      'principal:pat',
      `grant:${ulid(1)}`,
      'grant:g',
      `grant:${ulid(3)}`,
      'agent:ghost',
    ]);
    expect(graph.nodes.at(-1)).toEqual({
      id: 'agent:ghost',
      type: 'agent',
      label: 'ghost',
      ts: at(3),
      eventIds: [],
    });
    expect(graph.edges.map((edge) => `${edge.from} ${edge.type} ${edge.to}`).sort()).toEqual([
      `grant:${ulid(3)} delegates_to agent:ghost`,
      `principal:pat delegates_to grant:${ulid(0)}`,
      `principal:pat delegates_to grant:${ulid(3)}`,
      'principal:pat delegates_to grant:g',
    ]);
  });
});

describe('agents, principals and messaging', () => {
  it('delegates to subagents by span parentage and triggers agents from principals', () => {
    const graph = buildGraph([
      ev(0, { kind: 'principal.session', actor: HUMAN }),
      ev(1, { kind: 'agent.invoke', spanId: 'root', authority: { principalId: 'human:pat' } }),
      ev(2, {
        kind: 'agent.invoke',
        spanId: 'child',
        parentSpanId: 'root',
        actor: { type: 'subagent', id: 'subagent:helper' },
      }),
      ev(3, { kind: 'agent.invoke', spanId: 'again', parentSpanId: 'root' }),
      ev(4, {
        kind: 'delegation.grant',
        actor: HUMAN,
        attrs: { 'delegation.to': 'subagent:helper' },
      }),
      ev(5, { kind: 'agent.message', attrs: { 'agent.message.to': 'helper' } }),
      ev(6, { kind: 'agent.message' }),
      ev(7, { kind: 'agent.plan', actor: { type: 'subagent', id: 'subagent:helper' } }),
    ]);
    assertWellFormed(graph);
    expect(find(graph, 'principal:pat', 'agent:worker', 'triggers')?.confidence).toBe('exact');
    expect(find(graph, 'agent:worker', 'subagent:helper', 'delegates_to')?.confidence).toBe(
      'exact',
    );
    expect(find(graph, `grant:${ulid(4)}`, 'subagent:helper', 'delegates_to')).toBeDefined();
    expect(find(graph, 'agent:worker', 'subagent:helper', 'messages')?.eventIds).toEqual([ulid(5)]);
    expect(graph.nodes.find((node) => node.id === 'agent:worker')?.eventIds).toEqual([
      ulid(1),
      ulid(3),
      ulid(5),
      ulid(6),
    ]);
    expect(graph.nodes.find((node) => node.id === 'subagent:helper')?.eventIds).toEqual([
      ulid(2),
      ulid(7),
    ]);
  });

  it('only infers the principal when there is exactly one', () => {
    const none = buildGraph([ev(0, { kind: 'agent.invoke' })]);
    expect(none.edges).toEqual([]);
    const two = buildGraph([
      ev(0, { kind: 'principal.session', actor: HUMAN }),
      ev(1, { kind: 'principal.session', actor: { type: 'human', id: 'human:zed' } }),
      ev(2, { kind: 'agent.invoke' }),
    ]);
    expect(two.edges).toEqual([]);
    const humans = buildGraph([
      ev(0, { kind: 'human.approval', actor: { type: 'human', id: 'reviewer' } }),
    ]);
    expect(humans.nodes).toEqual([
      { id: 'human:reviewer', type: 'human', label: 'reviewer', ts: at(0), eventIds: [ulid(0)] },
    ]);
  });

  it('labels llm turns by model with fallbacks', () => {
    const graph = buildGraph([
      ev(0, {
        kind: 'llm.call',
        attrs: { 'gen_ai.response.model': 'm-2', 'gen_ai.request.model': 'm' },
      }),
      ev(1, { kind: 'llm.call', attrs: { 'gen_ai.request.model': 'm' } }),
      ev(2, { kind: 'llm.call' }),
    ]);
    expect(graph.nodes.filter((node) => node.type === 'llm').map((node) => node.label)).toEqual([
      'm-2',
      'm',
      'llm',
    ]);
  });
});

describe('mcp, policy, approvals, errors and world changes', () => {
  it('builds tools from bare mcp pairs and attaches policy decisions and errors', () => {
    const graph = buildGraph([
      ev(0, {
        kind: 'mcp.request',
        spanId: 'm1',
        target: { system: 'srv', operation: 'doThing' },
        attrs: { 'gen_ai.tool.name': 'doThing' },
      }),
      ev(1, {
        kind: 'policy.decision',
        spanId: 'm1',
        actor: { type: 'system', id: 'proxy' },
        attrs: { 'policy.rule.id': 'r1', 'policy.effect': 'deny' },
      }),
      ev(2, {
        kind: 'mcp.response',
        spanId: 'm1',
        target: { system: 'srv', operation: 'doThing' },
      }),
      ev(3, { kind: 'error', spanId: 'm1' }),
      ev(4, { kind: 'mcp.request', spanId: 'm2', attrs: { 'mcp.method.name': 'ping' } }),
      ev(5, { kind: 'mcp.request', spanId: 'm3' }),
      ev(6, {
        kind: 'policy.decision',
        actor: { type: 'system', id: 'proxy' },
        attrs: { 'policy.effect': 'warn' },
      }),
      ev(7, { kind: 'policy.decision', actor: { type: 'system', id: 'proxy' } }),
      ev(8, { kind: 'error' }),
      ev(9, { kind: 'mcp.response', actor: { type: 'agent', id: 'nobody' } }),
    ]);
    assertWellFormed(graph);
    const tool = graph.nodes.find((node) => node.id === `tool:${ulid(0)}`);
    expect(tool?.eventIds).toEqual([ulid(0), ulid(1), ulid(2), ulid(3)]);
    expect(find(graph, 'agent:worker', `tool:${ulid(0)}`, 'calls')).toBeDefined();
    expect(find(graph, `tool:${ulid(0)}`, 'system:srv', 'calls')).toBeDefined();
    expect(find(graph, 'system:srv', `tool:${ulid(0)}`, 'returns')?.confidence).toBe('exact');
    expect(find(graph, `policy:${ulid(1)}`, `tool:${ulid(0)}`, 'observes')).toBeDefined();
    expect(graph.nodes.filter((node) => node.type === 'policy').map((node) => node.label)).toEqual([
      'r1',
      'warn',
      'policy',
    ]);
    expect(graph.nodes.filter((node) => node.type === 'tool').map((node) => node.label)).toEqual([
      'doThing',
      'ping',
      'mcp',
    ]);
    expect(graph.nodes.find((node) => node.id === 'agent:worker')?.eventIds).toEqual([ulid(8)]);
    expect(graph.nodes.find((node) => node.id === 'agent:nobody')?.eventIds).toEqual([ulid(9)]);
  });

  it('attaches mcp responses by adjacency when the span is unknown', () => {
    const graph = buildGraph([
      ev(0, { kind: 'mcp.request', spanId: 'm1', target: { system: 'srv' } }),
      ev(1, { kind: 'mcp.response', target: { system: 'srv' } }),
      ev(2, { kind: 'mcp.response', target: { system: 'srv' } }),
    ]);
    expect(find(graph, 'system:srv', `tool:${ulid(0)}`, 'returns')?.confidence).toBe('strong');
    expect(graph.nodes.find((node) => node.id === 'agent:worker')?.eventIds).toEqual([ulid(2)]);
  });

  it('records human approvals against the approved call', () => {
    const graph = buildGraph([
      ev(0, { kind: 'tool.call', attrs: { 'gen_ai.tool.call.id': 'c1' } }),
      ev(1, { kind: 'human.approval', actor: HUMAN, attrs: { 'gen_ai.tool.call.id': 'c1' } }),
      ev(2, { kind: 'human.approval', actor: HUMAN }),
    ]);
    expect(find(graph, `tool:${ulid(0)}`, 'human:pat', 'authorized_by')?.confidence).toBe('exact');
    expect(graph.nodes.find((node) => node.id === 'human:pat')?.eventIds).toEqual([
      ulid(1),
      ulid(2),
    ]);
  });

  it('keys system nodes by target system, falling back to the actor', () => {
    const graph = buildGraph([
      ev(0, {
        kind: 'world.change',
        provenance: 'observed',
        source: 'world-hook',
        actor: { type: 'system', id: 'orbital-infra', name: 'Orbital infra' },
        target: { system: 'orbital', resource: 'projects/p/volumes/v', operation: 'deleteVolume' },
      }),
      ev(1, {
        kind: 'world.change',
        provenance: 'observed',
        source: 'world-hook',
        actor: { type: 'system', id: 'system:audit' },
      }),
    ]);
    expect(graph.nodes.map((node) => [node.id, node.label])).toEqual([
      ['resource:orbital:projects/p/volumes/v', 'projects/p/volumes/v'],
      ['system:orbital', 'Orbital infra'],
      ['system:audit', 'audit'],
    ]);
    expect(graph.edges).toEqual([
      {
        from: 'system:orbital',
        to: 'resource:orbital:projects/p/volumes/v',
        type: 'mutates',
        confidence: 'exact',
        eventIds: [ulid(0)],
      },
    ]);
  });
});

describe('timeline ordering', () => {
  it('orders by source time to the nanosecond, then by seq', () => {
    const a = ev(5, { kind: 'error', sourceTs: '2026-09-17T00:00:01.000000500Z' });
    const b = ev(1, { kind: 'error', sourceTs: '2026-09-17T00:00:01.0000004Z' });
    const c = ev(3, { kind: 'error', sourceTs: '2026-09-17T05:30:01+05:30' });
    const d = ev(0, { kind: 'error', sourceTs: '2026-09-17T00:00:01.000000500Z' });
    expect(sortTimeline([a, b, c, d]).map((event) => event.seq)).toEqual([3, 1, 0, 5]);
    expect(timelineKey(c)).toEqual([Date.UTC(2026, 8, 17, 0, 0, 1), 0, 3]);
    expect(timelineKey(ev(2, { kind: 'error', sourceTs: 'garbage' }))).toEqual([Number.NaN, 0, 2]);
  });
});
