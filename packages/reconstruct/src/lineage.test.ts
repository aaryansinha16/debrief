import type { Event } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import lineageGolden from '../__golden__/nine-seconds.lineage.json';
import { DEMO_RUN_ID, demoRunFixture } from './__fixtures__/nine-seconds.js';
import { HUMAN, at, ev, ulid } from './__fixtures__/synthetic.js';
import { withConsequences } from './blast.js';
import { applyWorldLinks, correlateWorld } from './correlate.js';
import { buildGraph } from './graph.js';
import {
  type AuthorityLineage,
  authorityLineage,
  permissionsExceedingScope,
  scopeCovers,
  targetDescriptor,
} from './lineage.js';
import type { CausalGraph } from './types.js';

const reconstruct = (events: readonly Event[], runId?: string): CausalGraph => {
  const base = buildGraph(events, runId === undefined ? {} : { runId });
  return withConsequences(applyWorldLinks(base, correlateWorld(events, base), events), events);
};
const shape = (lineage: AuthorityLineage): unknown[][] =>
  lineage.hops.map((hop) => [
    hop.type,
    hop.label,
    hop.authority?.scope,
    hop.authority?.permissions,
    hop.scopeMismatch?.map((m) => `${m.kind}/${m.severity}:${m.excess.join(',')}`),
  ]);

describe('authorityLineage on the demo run', () => {
  const events = demoRunFixture();
  const graph = reconstruct(events, DEMO_RUN_ID);
  const tools = graph.nodes.filter((node) => node.type === 'tool');
  const deleteTool = tools.filter((node) => node.label === 'deleteVolume').at(-1)!.id;

  it('walks human → coding-agent → token and flags the token hop with both rings', () => {
    const lineage = authorityLineage(graph, deleteTool, events);
    expect(lineage).toEqual(lineageGolden);
    expect(shape(lineage)).toEqual([
      ['principal', 'Aaryan', undefined, undefined, undefined],
      [
        'agent',
        'coding-agent',
        ['staging:credentials'],
        ['staging:credentials:read', 'staging:credentials:rotate', 'staging:files:read'],
        ['permissions-exceed-scope/minor:staging:files:read'],
      ],
      [
        'grant',
        'legacy migration token',
        ['staging:credentials'],
        ['account:*'],
        [
          'permissions-exceed-scope/major:account:*',
          'target-outside-scope/major:production:volumes:deleteVolume',
        ],
      ],
    ]);
    expect(lineage).toMatchObject({
      principalId: 'principal:aaryan',
      complete: true,
      authorityObserved: true,
      mismatches: 3,
      action: {
        label: 'deleteVolume',
        descriptor: 'production:volumes:deleteVolume',
        target: { resource: 'projects/nova/volumes/vol-prod-01', environment: 'production' },
      },
    });
    const token = lineage.hops[2]!;
    expect(token.authority).toMatchObject({
      grantNodeId: 'grant:tok-acct-9c1d',
      tokenRef: 'tok-acct-9c1d',
      grantId: 'tok-acct-9c1d',
      principalId: 'human:aaryan',
    });
    expect(token.scopeMismatch?.[0]).toEqual({
      kind: 'permissions-exceed-scope',
      severity: 'major',
      scope: ['staging:credentials'],
      permissions: ['account:*'],
      excess: ['account:*'],
    });
  });

  it('keeps the rotation inside scope and infers authority for calls without an observed token', () => {
    const rotate = authorityLineage(
      graph,
      tools.find((node) => node.label === 'rotateCredential')!.id,
      events,
    );
    expect(rotate).toMatchObject({ complete: true, authorityObserved: true, mismatches: 1 });
    expect(rotate.action.descriptor).toBe('staging:credentials:rotateCredential');
    expect(rotate.hops.map((hop) => hop.type)).toEqual(['principal', 'agent']);
    const list = authorityLineage(graph, tools[0]!.id, events);
    expect(list).toMatchObject({ complete: true, authorityObserved: false, mismatches: 1 });
    expect(list.hops.map((hop) => hop.authority?.grantNodeId)).toEqual([
      undefined,
      'grant:tok-stg-7f3a',
    ]);
    const agent = authorityLineage(graph, 'agent:coding-agent', events);
    expect(shape(agent)).toEqual(shape(list));
    expect(agent.action).toEqual({ nodeId: 'agent:coding-agent', label: 'coding-agent' });
  });

  it('returns an empty lineage for unknown nodes', () => {
    expect(authorityLineage(graph, 'nope', events)).toEqual({
      origin: 'nope',
      action: { nodeId: 'nope', label: 'nope' },
      hops: [],
      complete: false,
      authorityObserved: false,
      mismatches: 0,
    });
  });
});

describe('scope matching', () => {
  it('covers by colon-separated prefix with wildcards', () => {
    expect(scopeCovers('staging:credentials', 'staging:credentials:rotate')).toBe(true);
    expect(scopeCovers('staging:*', 'staging:files:read')).toBe(true);
    expect(scopeCovers('staging:credentials', 'staging:files:read')).toBe(false);
    expect(scopeCovers('staging:credentials:read', 'staging:credentials')).toBe(false);
    expect(permissionsExceedingScope(['staging:*'], ['staging:a', 'prod:b'])).toEqual(['prod:b']);
  });

  it('describes targets as environment:class:operation', () => {
    expect(targetDescriptor({ system: 'orbital' })).toBeUndefined();
    expect(targetDescriptor({ system: 'orbital', environment: 'staging' })).toBe('staging:*:*');
    expect(targetDescriptor({ system: 'orbital', resource: 'bucket', operation: 'read' })).toBe(
      'unknown:bucket:read',
    );
    expect(
      targetDescriptor({
        system: 'orbital',
        resource: 'projects/p/volumes/v',
        environment: 'production',
        operation: 'deleteVolume',
      }),
    ).toBe('production:volumes:deleteVolume');
  });
});

describe('lineage walks', () => {
  const grant = (
    seq: number,
    actor: Event['actor'],
    to: string,
    authority: NonNullable<Event['authority']>,
    label = `token-${String(seq)}`,
  ): Event =>
    ev(seq, {
      kind: 'delegation.grant',
      actor,
      authority,
      attrs: { 'delegation.to': to, 'delegation.token.label': label },
    });

  it('follows subagent delegation by span parentage and human approvals', () => {
    const events = [
      ev(0, { kind: 'principal.session', actor: HUMAN }),
      grant(1, HUMAN, 'agent:worker', {
        principalId: 'human:pat',
        tokenRef: 'tok-w',
        scope: ['staging:*'],
        permissions: ['staging:files:read'],
      }),
      ev(2, { kind: 'agent.invoke', spanId: 'root' }),
      ev(3, {
        kind: 'agent.invoke',
        spanId: 'child',
        parentSpanId: 'root',
        actor: { type: 'subagent', id: 'subagent:helper' },
      }),
      ev(4, {
        kind: 'tool.call',
        spanId: 't1',
        actor: { type: 'subagent', id: 'subagent:helper' },
        target: {
          system: 'orbital',
          resource: 'projects/p/files/f',
          environment: 'staging',
          operation: 'readFile',
        },
      }),
      ev(5, {
        kind: 'human.approval',
        actor: { type: 'human', id: 'reviewer' },
        attrs: { 'gen_ai.tool.call.id': 'c9' },
      }),
      ev(6, { kind: 'tool.call', spanId: 't2', attrs: { 'gen_ai.tool.call.id': 'c9' } }),
    ];
    const graph = reconstruct(events);
    const viaSubagent = authorityLineage(graph, `tool:${ulid(4)}`, events);
    expect(shape(viaSubagent)).toEqual([
      ['principal', 'Pat', undefined, undefined, undefined],
      ['agent', 'worker', ['staging:*'], ['staging:files:read'], undefined],
      ['subagent', 'helper', undefined, undefined, undefined],
    ]);
    expect(viaSubagent).toMatchObject({
      complete: true,
      authorityObserved: false,
      action: { descriptor: 'staging:files:readFile' },
    });
    const approved = authorityLineage(graph, `tool:${ulid(6)}`, events);
    expect(approved.hops.map((hop) => hop.type)).toEqual(['principal', 'agent']);
  });

  it('stops at revoked-only tokens, cycles and callers without a principal', () => {
    const events = [
      ev(0, {
        kind: 'delegation.revoke',
        actor: { type: 'agent', id: 'agent:other' },
        authority: { principalId: 'human:pat', tokenRef: 'tok-r' },
      }),
      ev(1, {
        kind: 'tool.call',
        spanId: 't1',
        authority: { principalId: 'human:pat', tokenRef: 'tok-r' },
      }),
      grant(2, { type: 'agent', id: 'agent:a' }, 'agent:b', {
        principalId: 'human:pat',
        tokenRef: 'tok-ab',
      }),
      grant(3, { type: 'agent', id: 'agent:b' }, 'agent:a', {
        principalId: 'human:pat',
        tokenRef: 'tok-ba',
      }),
      ev(4, { kind: 'tool.call', spanId: 't2', actor: { type: 'agent', id: 'agent:a' } }),
      ev(5, { kind: 'tool.call', spanId: 't3', actor: { type: 'agent', id: 'agent:lone' } }),
    ];
    const graph = reconstruct(events);
    const revoked = authorityLineage(graph, `tool:${ulid(1)}`, events);
    expect(revoked.hops.map((hop) => [hop.type, hop.label])).toEqual([['agent', 'worker']]);
    expect(revoked).toMatchObject({ complete: false, authorityObserved: true });
    expect(revoked.hops[0]?.authority).toMatchObject({
      grantNodeId: 'grant:tok-r',
      scope: [],
      permissions: [],
      tokenRef: 'tok-r',
    });
    const cyclic = authorityLineage(graph, `tool:${ulid(4)}`, events);
    expect(cyclic.hops.map((hop) => hop.label)).toEqual(['b', 'a']);
    expect(cyclic.complete).toBe(false);
    const lone = authorityLineage(graph, `tool:${ulid(5)}`, events);
    expect(lone.hops.map((hop) => hop.label)).toEqual(['lone']);
    expect(lone.principalId).toBeUndefined();
  });

  it('reads grant ids without token refs and survives grant cycles', () => {
    const events = [
      grant(0, HUMAN, 'agent:worker', { principalId: 'human:pat', grantId: 'g-only' }),
      ev(1, {
        kind: 'tool.call',
        spanId: 't1',
        authority: { principalId: 'human:pat', grantId: 'g-only' },
      }),
    ];
    const graph = reconstruct(events);
    const lineage = authorityLineage(graph, `tool:${ulid(1)}`, events);
    expect(lineage.hops[1]?.authority).toEqual({
      grantNodeId: 'grant:g-only',
      principalId: 'human:pat',
      grantId: 'g-only',
      scope: [],
      permissions: [],
      eventIds: [ulid(0)],
    });
    const cyclic: CausalGraph = {
      runId: 'run-x',
      version: '1',
      nodes: [
        { id: 'tool:t', type: 'tool', label: 'doIt', ts: at(0), eventIds: [] },
        { id: 'agent:a', type: 'agent', label: 'a', ts: at(0), eventIds: [] },
        { id: 'grant:x', type: 'grant', label: 'x', ts: at(0), eventIds: [] },
        { id: 'grant:y', type: 'grant', label: 'y', ts: at(0), eventIds: [] },
      ],
      edges: [
        { from: 'agent:a', to: 'tool:t', type: 'calls', confidence: 'exact', eventIds: [] },
        { from: 'tool:t', to: 'grant:x', type: 'authorized_by', confidence: 'exact', eventIds: [] },
        { from: 'grant:x', to: 'agent:a', type: 'delegates_to', confidence: 'exact', eventIds: [] },
        { from: 'grant:y', to: 'agent:a', type: 'delegates_to', confidence: 'exact', eventIds: [] },
        {
          from: 'grant:x',
          to: 'agent:a',
          type: 'authorized_by',
          confidence: 'exact',
          eventIds: [],
        },
        {
          from: 'grant:y',
          to: 'agent:a',
          type: 'authorized_by',
          confidence: 'exact',
          eventIds: [],
        },
      ],
    };
    const looped = authorityLineage(cyclic, 'tool:t', []);
    expect(looped.hops.map((hop) => hop.nodeId)).toEqual(['agent:a']);
    expect(looped.complete).toBe(false);
    const fromAgent = authorityLineage(cyclic, 'agent:a', []);
    expect(fromAgent.hops.map((hop) => [hop.nodeId, hop.authority?.grantNodeId])).toEqual([
      ['agent:a', 'grant:y'],
    ]);
  });

  it('prefers the latest grant that predates the action', () => {
    const events = [
      grant(0, HUMAN, 'agent:worker', {
        principalId: 'human:pat',
        tokenRef: 'early',
        scope: ['a'],
        permissions: ['a:x'],
      }),
      ...[ev(5, { kind: 'tool.call', spanId: 't1' }), ev(6, { kind: 'tool.result', spanId: 't1' })],
      grant(7, HUMAN, 'agent:worker', {
        principalId: 'human:pat',
        tokenRef: 'late',
        scope: ['b'],
        permissions: ['b:y'],
      }),
      ...[ev(8, { kind: 'tool.call', spanId: 't2' }), ev(9, { kind: 'tool.result', spanId: 't2' })],
      ev(10, {
        kind: 'agent.invoke',
        spanId: 'root',
        actor: { type: 'agent', id: 'agent:worker' },
        sourceTs: at(-1),
      }),
    ];
    const graph = reconstruct(events);
    expect(authorityLineage(graph, `tool:${ulid(5)}`, events).hops[1]?.authority?.tokenRef).toBe(
      'early',
    );
    expect(authorityLineage(graph, `tool:${ulid(8)}`, events).hops[1]?.authority?.tokenRef).toBe(
      'late',
    );
    expect(authorityLineage(graph, 'agent:worker', events).hops[1]?.authority?.tokenRef).toBe(
      'early',
    );
  });

  it('handles hand-built graphs with orphan grants and missing endpoints', () => {
    const events = [
      ev(0, {
        kind: 'tool.call',
        spanId: 't1',
        target: { system: 'orbital', environment: 'production' },
      }),
      ev(1, {
        kind: 'delegation.grant',
        actor: HUMAN,
        authority: { principalId: 'human:pat', tokenRef: 'g', scope: ['production:*'] },
      }),
    ];
    const graph: CausalGraph = {
      runId: 'run-x',
      version: '1',
      nodes: [
        { id: 'tool:t', type: 'tool', label: 'doIt', ts: at(0), eventIds: [ulid(0)] },
        { id: 'grant:g', type: 'grant', label: 'g', ts: at(1), eventIds: [ulid(1), ulid(99)] },
        { id: 'principal:pat', type: 'principal', label: 'Pat', ts: at(1), eventIds: [] },
        { id: 'human:pat', type: 'human', label: 'Pat', ts: at(1), eventIds: [] },
        { id: 'grant:orphan', type: 'grant', label: 'orphan', ts: at(1), eventIds: [] },
      ],
      edges: [
        {
          from: 'tool:t',
          to: 'grant:g',
          type: 'authorized_by',
          confidence: 'exact',
          eventIds: [ulid(0)],
        },
        {
          from: 'grant:g',
          to: 'principal:pat',
          type: 'authorized_by',
          confidence: 'exact',
          eventIds: [ulid(1)],
        },
        {
          from: 'grant:orphan',
          to: 'human:pat',
          type: 'delegates_to',
          confidence: 'exact',
          eventIds: [ulid(1)],
        },
      ],
    };
    const lineage = authorityLineage(graph, 'tool:t', events);
    expect(shape(lineage)).toEqual([
      ['principal', 'Pat', undefined, undefined, undefined],
      ['grant', 'g', ['production:*'], [], undefined],
    ]);
    expect(lineage).toMatchObject({ complete: true, action: { descriptor: 'production:*:*' } });
    const human = authorityLineage(graph, 'human:pat', events);
    expect(shape(human)).toEqual([['human', 'Pat', [], [], undefined]]);
    expect(human.principalId).toBe('human:pat');
    const orphan = authorityLineage(graph, 'grant:orphan', events);
    expect(orphan.hops).toEqual([{ nodeId: 'grant:orphan', type: 'grant', label: 'orphan' }]);
  });
});
