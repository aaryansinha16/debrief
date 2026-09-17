import { ALLOW_ALL, type Policy, parsePolicy } from '@debrief/policy';
import type { Event } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import divergenceGolden from '../__golden__/nine-seconds.divergence.json';
import { DEMO_RUN_ID, demoRunFixture } from './__fixtures__/nine-seconds.js';
import { ev, ulid } from './__fixtures__/synthetic.js';
import { divergence } from './divergence.js';
import { reconstructGraph } from './pipeline.js';

const PROD_GUARD = `
version: 1
defaults: allow
rules:
  - id: prod-destructive-needs-approval
    match: { target.environment: production, target.risk: [high, critical], target.operation: [delete, drop, truncate, transfer] }
    effect: require_approval
  - id: token-scope-mismatch
    match: { authority.scopeMismatch: true }
    effect: deny
  - id: unknown-environment-destructive
    match: { target.environment: unknown, target.operation: [delete, drop, truncate] }
    effect: require_approval
`;
const prodGuard = parsePolicy(PROD_GUARD);
const DENY_ALL: Policy = { version: 1, defaults: 'deny', rules: [] };

const world = (seq: number, patch: Partial<Event> = {}): Event =>
  ev(seq, {
    kind: 'world.change',
    source: 'world-hook',
    provenance: 'observed',
    actor: { type: 'system', id: 'orbital-infra' },
    target: {
      system: 'orbital',
      resource: 'projects/p/volumes/v',
      environment: 'production',
      operation: 'deleteVolume',
      risk: 'critical',
    },
    ...patch,
  });
const call = (seq: number, name: string, patch: Partial<Event> = {}): Event[] => [
  ev(seq, {
    kind: 'tool.call',
    spanId: `s${String(seq)}`,
    attrs: { 'gen_ai.tool.name': name },
    ...patch,
  }),
  ev(seq + 1, { kind: 'tool.result', spanId: `s${String(seq)}` }),
];

describe('divergence on the demo run', () => {
  const events = demoRunFixture();
  const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });

  it('diverges at the deleteVolume call under prod-guard', () => {
    const report = divergence(events, prodGuard, graph);
    expect(report).toEqual(divergenceGolden);
    expect(report.evaluated).toBe(8);
    expect(report.points).toHaveLength(1);
    const deleteCalls = events.filter(
      (event) => event.kind === 'tool.call' && event.attrs['gen_ai.tool.name'] === 'deleteVolume',
    );
    expect(report.freezeFrame).toMatchObject({
      eventId: deleteCalls.at(-1)!.id,
      seq: 45,
      kind: 'tool.call',
      effect: 'require_approval',
      ruleId: 'prod-destructive-needs-approval',
      explanation:
        'rule prod-destructive-needs-approval matched target.environment="production", target.risk="critical", target.operation="deleteVolume"',
    });
    expect(graph.nodes.find((node) => node.id === report.freezeFrame?.nodeId)?.label).toBe(
      'deleteVolume',
    );
  });

  it('diverges nowhere under allow-all and reconstructs the graph itself when none is given', () => {
    const allowed = divergence(events, ALLOW_ALL, graph);
    expect(allowed).toEqual({ runId: DEMO_RUN_ID, evaluated: 8, points: [] });
    expect(divergence(events, prodGuard)).toEqual(divergenceGolden);
  });
});

describe('actionable events and policy context', () => {
  it('evaluates bare mcp calls, unlinked world changes and calls without any world link', () => {
    const events = [
      ev(0, {
        kind: 'mcp.request',
        spanId: 'm1',
        target: { system: 'orbital-mcp', operation: 'deleteVolume' },
      }),
      ev(1, {
        kind: 'mcp.response',
        spanId: 'm1',
        target: { system: 'orbital-mcp', operation: 'deleteVolume' },
      }),
      ...call(2, 'listVolumes'),
      world(30, { sourceTs: '2026-09-17T00:05:00.000Z', authority: undefined }),
    ];
    const report = divergence(events, prodGuard);
    expect(report.evaluated).toBe(3);
    expect(report.points).toEqual([
      {
        eventId: ulid(30),
        seq: 30,
        kind: 'world.change',
        effect: 'require_approval',
        ruleId: 'prod-destructive-needs-approval',
        explanation:
          'rule prod-destructive-needs-approval matched target.environment="production", target.risk="critical", target.operation="deleteVolume"',
      },
    ]);
    const denied = divergence(events, DENY_ALL);
    expect(denied.points.map((point) => [point.seq, point.kind, point.ruleId])).toEqual([
      [0, 'mcp.request', undefined],
      [2, 'tool.call', undefined],
      [30, 'world.change', undefined],
    ]);
    expect(denied.freezeFrame?.nodeId).toBe(`tool:${ulid(0)}`);
  });

  it('denies a call whose observed token mismatches, but never asserts unobserved authority', () => {
    const account = {
      principalId: 'human:pat',
      tokenRef: 'tok-acct',
      scope: ['staging:credentials'],
      permissions: ['account:*'],
    };
    const events = [
      ev(0, {
        kind: 'delegation.grant',
        actor: { type: 'human', id: 'human:pat' },
        authority: account,
        attrs: { 'delegation.to': 'agent:worker' },
      }),
      ...call(1, 'readFile'),
      world(2, {
        authority: account,
        target: {
          system: 'orbital',
          resource: 'projects/p/files/f',
          environment: 'staging',
          operation: 'readFile',
          risk: 'low',
        },
      }),
      ...call(10, 'listVolumes'),
    ];
    const report = divergence(events, prodGuard);
    expect(report.points).toEqual([
      {
        eventId: ulid(1),
        seq: 1,
        kind: 'tool.call',
        nodeId: `tool:${ulid(1)}`,
        effect: 'deny',
        ruleId: 'token-scope-mismatch',
        explanation: 'rule token-scope-mismatch matched authority.scopeMismatch=true',
      },
    ]);
    expect(report.freezeFrame).toEqual(report.points[0]);
  });

  it('overlays the observed target on the call and skips world changes without targets', () => {
    const events = [
      ...call(0, 'deleteVolume', { target: { system: 'extension', operation: 'deleteVolume' } }),
      world(1),
      world(5, { target: undefined, sourceTs: '2026-09-17T00:00:05.000Z' }),
    ];
    const report = divergence(events, prodGuard);
    expect(report.evaluated).toBe(2);
    expect(report.freezeFrame).toMatchObject({
      seq: 0,
      kind: 'tool.call',
      effect: 'require_approval',
    });
    const stripped = events.map((event) =>
      event.kind === 'world.change' && event.seq === 1
        ? { ...event, target: { system: 'orbital', operation: 'deleteVolume' } }
        : event,
    );
    expect(divergence(stripped, prodGuard).points).toEqual([]);
  });

  it('treats an observed token that covers the action as clean, even without recorded authority', () => {
    const covering = {
      principalId: 'human:pat',
      tokenRef: 'tok-prod',
      scope: ['production:volumes'],
      permissions: ['production:volumes:resize'],
    };
    const events = [
      ev(0, {
        kind: 'delegation.grant',
        actor: { type: 'human', id: 'human:pat' },
        authority: covering,
        attrs: { 'delegation.to': 'agent:worker' },
      }),
      ...call(1, 'resizeVolume'),
      world(2, {
        authority: covering,
        target: {
          system: 'orbital',
          resource: 'projects/p/volumes/v',
          environment: 'production',
          operation: 'resizeVolume',
          risk: 'medium',
        },
      }),
    ];
    expect(divergence(events, prodGuard).points).toEqual([]);
    const graph = reconstructGraph(events);
    const tool = `tool:${ulid(1)}`;
    const bare = {
      ...graph,
      nodes: graph.nodes.map((node) => (node.type === 'grant' ? { ...node, eventIds: [] } : node)),
    };
    expect(divergence(events, prodGuard, bare).points).toEqual([]);
    expect(divergence(events, DENY_ALL, bare).freezeFrame?.nodeId).toBe(tool);
  });

  it('ignores tool nodes whose primary event is not among the events given', () => {
    const events = [...call(0, 'deleteVolume'), world(1)];
    const graph = reconstructGraph(events);
    const report = divergence(events.slice(1), prodGuard, graph);
    expect(report.evaluated).toBe(0);
    expect(report.points).toEqual([]);
  });
});
