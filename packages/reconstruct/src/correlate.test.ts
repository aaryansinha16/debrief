import type { Event } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import graphGolden from '../__golden__/nine-seconds.graph.json';
import linksGolden from '../__golden__/nine-seconds.links.json';
import { DEMO_RUN_ID, demoRunFixture } from './__fixtures__/nine-seconds.js';
import { HUMAN, at, ev, ulid } from './__fixtures__/synthetic.js';
import { applyWorldLinks, correlateWorld, parseTraceparent } from './correlate.js';
import { buildGraph } from './graph.js';
import type { CausalGraph, GraphEdge } from './types.js';

const TRACE = 'a'.repeat(32);
const SPAN = 'd'.repeat(16);
const PROXY_SPAN = 'b'.repeat(16);
const withoutTraceparent = (event: Event): Event => {
  const { traceparent: _traceparent, ...attrs } = event.attrs;
  return { ...event, attrs };
};
const labelOf = (graph: CausalGraph, id: string): string | undefined =>
  graph.nodes.find((node) => node.id === id)?.label;
const edge = (
  graph: CausalGraph,
  from: string,
  to: string,
  type: GraphEdge['type'],
): GraphEdge | undefined =>
  graph.edges.find(
    (candidate) => candidate.from === from && candidate.to === to && candidate.type === type,
  );

const world = (seq: number, patch: Partial<Event> = {}): Event =>
  ev(seq, {
    kind: 'world.change',
    source: 'world-hook',
    provenance: 'observed',
    actor: { type: 'system', id: 'orbital-infra' },
    target: { system: 'orbital', resource: 'projects/p/volumes/v', operation: 'deleteVolume' },
    ...patch,
  });

describe('correlateWorld on the demo run', () => {
  const events = demoRunFixture();
  const graph = buildGraph(events, { runId: DEMO_RUN_ID });

  it('links both world changes exactly by traceparent', () => {
    const links = correlateWorld(events, graph);
    expect(links).toEqual(linksGolden);
    expect(
      links.map((link) => [link.confidence, link.reason, labelOf(graph, link.toolNodeId)]),
    ).toEqual([
      ['exact', 'traceparent', 'rotateCredential'],
      ['exact', 'traceparent', 'deleteVolume'],
    ]);
    const deleteTools = graph.nodes.filter((node) => node.label === 'deleteVolume');
    expect(links[1]?.toolNodeId).toBe(deleteTools[1]?.id);
  });

  it('falls back to a strong operation match when traceparents are stripped', () => {
    const stripped = events.map((event) =>
      event.kind === 'world.change' ? withoutTraceparent(event) : event,
    );
    const links = correlateWorld(stripped, buildGraph(stripped, { runId: DEMO_RUN_ID }));
    expect(
      links.map((link) => [link.confidence, link.reason, labelOf(graph, link.toolNodeId)]),
    ).toEqual([
      ['strong', 'operation', 'rotateCredential'],
      ['strong', 'operation', 'deleteVolume'],
    ]);
    expect(links.map((link) => link.toolNodeId)).toEqual(
      linksGolden.map((link) => link.toolNodeId),
    );
  });

  it('links nothing for a decoy mutation 30 s later', () => {
    const original = events.find(
      (event) => event.kind === 'world.change' && event.target?.operation === 'deleteVolume',
    )!;
    const later = new Date(Date.parse(original.sourceTs) + 30_000).toISOString();
    const decoy = withoutTraceparent({
      ...original,
      id: ulid(900),
      seq: 900,
      ts: later,
      sourceTs: later,
    });
    const links = correlateWorld([...events, decoy], graph);
    expect(links).toEqual(linksGolden);
    expect(correlateWorld([decoy], graph)).toEqual([]);
  });

  it('applies links as tool→resource mutations carrying the world-observed authority', () => {
    const links = correlateWorld(events, graph);
    const applied = applyWorldLinks(graph, links, events);
    expect(graph).toEqual(graphGolden);
    expect(applied.nodes).toEqual(graph.nodes);
    expect(applied.edges).toHaveLength(graph.edges.length + 4);
    const [rotate, remove] = links;
    expect(
      edge(
        applied,
        rotate!.toolNodeId,
        'resource:orbital:projects/nova/environments/staging/credentials/DATABASE_URL',
        'mutates',
      ),
    ).toMatchObject({ confidence: 'exact', eventIds: [rotate!.worldEventId] });
    expect(
      edge(applied, rotate!.toolNodeId, 'grant:tok-stg-7f3a', 'authorized_by')?.confidence,
    ).toBe('exact');
    expect(
      edge(
        applied,
        remove!.toolNodeId,
        'resource:orbital:projects/nova/volumes/vol-prod-01',
        'mutates',
      )?.confidence,
    ).toBe('exact');
    expect(
      edge(applied, remove!.toolNodeId, 'grant:tok-acct-9c1d', 'authorized_by')?.confidence,
    ).toBe('exact');
    expect(applyWorldLinks(applied, links, events)).toEqual(applied);
  });
});

describe('correlation tiers', () => {
  const tools = (): Event[] => [
    ev(0, { kind: 'tool.call', spanId: SPAN, attrs: { 'gen_ai.tool.name': 'deleteVolume' } }),
    ev(1, {
      kind: 'mcp.request',
      spanId: 'm1',
      parentSpanId: SPAN,
      target: { system: 'orbital-mcp', operation: 'deleteVolume' },
      attrs: { traceparent: `00-${TRACE}-${PROXY_SPAN}-01` },
    }),
    ev(2, {
      kind: 'mcp.response',
      spanId: 'm1',
      target: { system: 'orbital-mcp', operation: 'deleteVolume' },
    }),
    ev(3, { kind: 'tool.result', spanId: SPAN }),
    ev(10, {
      kind: 'tool.call',
      spanId: 's2',
      authority: { principalId: 'human:pat', tokenRef: 'tok-a' },
      target: { system: 'orbital', operation: 'listVolumes' },
    }),
    ev(11, { kind: 'tool.result', spanId: 's2' }),
  ];
  const run = (events: readonly Event[]): Event[] =>
    events.map((event) => ({ ...event, runId: TRACE }));

  it('matches traceparents from the proxy span, own span and rejects other traces', () => {
    const events = run(tools());
    const graph = buildGraph(events);
    const viaProxy = world(4, {
      runId: TRACE,
      attrs: { traceparent: `00-${TRACE}-${PROXY_SPAN}-01` },
    });
    const viaSpan = world(5, { runId: TRACE, attrs: { traceparent: `00-${TRACE}-${SPAN}-01` } });
    const otherTrace = world(6, {
      runId: TRACE,
      attrs: { traceparent: `00-${'c'.repeat(32)}-${PROXY_SPAN}-01` },
    });
    expect(correlateWorld([...events, viaProxy], graph)).toEqual([
      {
        worldEventId: ulid(4),
        toolNodeId: `tool:${ulid(0)}`,
        confidence: 'exact',
        reason: 'traceparent',
        deltaMs: 1000,
      },
    ]);
    expect(correlateWorld([...events, viaSpan], graph)).toMatchObject([
      { toolNodeId: `tool:${ulid(0)}`, confidence: 'exact', reason: 'traceparent', deltaMs: 2000 },
    ]);
    expect(correlateWorld([...events, otherTrace], graph)).toEqual([]);
    expect(parseTraceparent(`00-${TRACE}-${PROXY_SPAN}-01`)).toEqual({
      traceId: TRACE,
      spanId: PROXY_SPAN,
    });
    expect(parseTraceparent('nope')).toBeUndefined();
    expect(parseTraceparent(7)).toBeUndefined();
  });

  it('prefers token matches, then operation, then system, within their windows', () => {
    const events = run(tools());
    const graph = buildGraph(events);
    const byToken = world(12, {
      runId: TRACE,
      authority: { principalId: 'human:pat', grantId: 'tok-a' },
      target: { system: 'orbital', operation: 'somethingElse' },
    });
    const byOperation = world(4, { runId: TRACE });
    const bySystem = world(8, {
      runId: TRACE,
      target: { system: 'orbital', operation: 'somethingElse' },
    });
    const tooLate = world(30, { runId: TRACE });
    const noTarget = world(4, { runId: TRACE, target: undefined });
    expect(correlateWorld([...events, byToken], graph)).toMatchObject([
      { toolNodeId: `tool:${ulid(10)}`, confidence: 'strong', reason: 'token', deltaMs: 1000 },
    ]);
    expect(correlateWorld([...events, byOperation], graph)).toMatchObject([
      { toolNodeId: `tool:${ulid(0)}`, confidence: 'strong', reason: 'operation', deltaMs: 1000 },
    ]);
    expect(correlateWorld([...events, bySystem], graph)).toMatchObject([
      { toolNodeId: `tool:${ulid(10)}`, confidence: 'weak', reason: 'system', deltaMs: 2000 },
    ]);
    expect(correlateWorld([...events, tooLate], graph)).toEqual([]);
    const foreignSystem = world(8, {
      runId: TRACE,
      target: { system: 'github', operation: 'somethingElse' },
    });
    expect(correlateWorld([...events, foreignSystem], graph)).toEqual([]);
    const reversedPrefix = world(18, {
      runId: TRACE,
      target: { system: 'orbital-mcp', operation: 'somethingElse' },
    });
    expect(correlateWorld([...events, reversedPrefix], graph)).toMatchObject([
      { toolNodeId: `tool:${ulid(10)}`, confidence: 'weak', reason: 'system', deltaMs: 7000 },
    ]);
    expect(correlateWorld([...events, noTarget], graph)).toEqual([]);
    expect(
      correlateWorld([...events, byOperation], graph, { strongMs: 500, weakMs: 20_000 }),
    ).toMatchObject([{ confidence: 'weak', reason: 'system' }]);
  });

  it('picks the nearest candidate at equal confidence and ignores unknown tool events', () => {
    const events = run([
      ...tools(),
      ev(4, { kind: 'tool.call', spanId: 's4', attrs: { 'gen_ai.tool.name': 'deleteVolume' } }),
      ev(5, { kind: 'tool.result', spanId: 's4' }),
      ev(20, { kind: 'tool.call', spanId: 's3', attrs: { 'gen_ai.tool.name': 'deleteVolume' } }),
      ev(21, { kind: 'tool.result', spanId: 's3' }),
    ]);
    const graph = buildGraph(events);
    const near = world(19, { runId: TRACE, sourceTs: at(19, 500) });
    expect(correlateWorld([...events, near], graph)).toMatchObject([
      { toolNodeId: `tool:${ulid(20)}`, deltaMs: 500 },
    ]);
    const inside = world(2, { runId: TRACE, sourceTs: at(2, 250) });
    expect(correlateWorld([...events, inside], graph)).toMatchObject([
      { toolNodeId: `tool:${ulid(0)}`, deltaMs: 0 },
    ]);
    const partial = events.filter((event) => event.kind !== 'tool.result');
    expect(correlateWorld([...partial, near], graph)).toMatchObject([
      { toolNodeId: `tool:${ulid(20)}`, deltaMs: 500 },
    ]);
  });
});

describe('applyWorldLinks', () => {
  const base = (): Event[] => [
    ev(0, {
      kind: 'delegation.grant',
      actor: HUMAN,
      authority: { principalId: 'human:pat', grantId: 'g-1' },
    }),
    ev(1, {
      kind: 'tool.call',
      spanId: 's1',
      target: { system: 'orbital', operation: 'deleteVolume' },
      attrs: { 'gen_ai.tool.name': 'deleteVolume' },
    }),
    ev(2, { kind: 'tool.result', spanId: 's1' }),
  ];

  it('skips links whose world event, resource or tool is missing', () => {
    const events = base();
    const graph = buildGraph(events);
    const unknownWorld = {
      worldEventId: ulid(99),
      toolNodeId: `tool:${ulid(1)}`,
      confidence: 'exact',
      reason: 'traceparent',
      deltaMs: 0,
    } as const;
    const noResource = world(3, { target: { system: 'orbital', operation: 'deleteVolume' } });
    const orphanResource = world(4);
    expect(applyWorldLinks(graph, [unknownWorld], events)).toEqual(graph);
    const graphWithNoResource = buildGraph([...events, noResource]);
    expect(
      applyWorldLinks(
        graphWithNoResource,
        [{ ...unknownWorld, worldEventId: ulid(3) }],
        [...events, noResource],
      ),
    ).toEqual(graphWithNoResource);
    expect(
      applyWorldLinks(
        graph,
        [{ ...unknownWorld, worldEventId: ulid(4) }],
        [...events, orphanResource],
      ),
    ).toEqual(graph);
    const graphWithResource = buildGraph([...events, orphanResource]);
    expect(
      applyWorldLinks(
        graphWithResource,
        [{ ...unknownWorld, worldEventId: ulid(4), toolNodeId: 'tool:nope' }],
        [...events, orphanResource],
      ),
    ).toEqual(graphWithResource);
  });

  it('adds authority edges via grant id, principal, or not at all', () => {
    const events = base();
    const byGrant = world(3, { authority: { principalId: 'human:pat', grantId: 'g-1' } });
    const byPrincipal = world(4, { authority: { principalId: 'human:pat', tokenRef: 'unknown' } });
    const unknownPrincipal = world(5, { authority: { principalId: 'human:zed' } });
    const noAuthority = world(6);
    const all = [...events, byGrant, byPrincipal, unknownPrincipal, noAuthority];
    const graph = buildGraph(all);
    const links = correlateWorld(all, graph);
    expect(links.map((link) => link.confidence)).toEqual(['strong', 'strong', 'weak', 'weak']);
    const applied = applyWorldLinks(graph, links, all);
    const tool = `tool:${ulid(1)}`;
    expect(edge(applied, tool, 'grant:g-1', 'authorized_by')).toMatchObject({
      confidence: 'strong',
      eventIds: [ulid(3)],
    });
    expect(edge(applied, tool, 'principal:pat', 'authorized_by')).toMatchObject({
      confidence: 'strong',
      eventIds: [ulid(4)],
    });
    expect(applied.edges.filter((candidate) => candidate.type === 'authorized_by')).toHaveLength(2);
    expect(edge(applied, tool, 'resource:orbital:projects/p/volumes/v', 'mutates')).toMatchObject({
      confidence: 'strong',
      eventIds: [ulid(3), ulid(4), ulid(5), ulid(6)],
    });
    const upgraded = applyWorldLinks(applied, [{ ...links[3]!, confidence: 'exact' }], all);
    expect(
      edge(upgraded, tool, 'resource:orbital:projects/p/volumes/v', 'mutates')?.confidence,
    ).toBe('exact');
  });
});
