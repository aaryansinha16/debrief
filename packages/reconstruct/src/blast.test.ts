import type { Event } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import blastGolden from '../__golden__/nine-seconds.blast.json';
import { DEMO_RUN_ID, demoRunFixture } from './__fixtures__/nine-seconds.js';
import { ev, ulid } from './__fixtures__/synthetic.js';
import { type BlastRadius, blastRadius, withConsequences } from './blast.js';
import { applyWorldLinks, correlateWorld } from './correlate.js';
import { buildGraph } from './graph.js';
import type { CausalGraph, GraphEdge } from './types.js';

const reconstruct = (events: readonly Event[], runId?: string): CausalGraph => {
  const base = buildGraph(events, runId === undefined ? {} : { runId });
  return withConsequences(applyWorldLinks(base, correlateWorld(events, base), events), events);
};
const shape = (blast: BlastRadius): (string | boolean | number)[][][] =>
  blast.waves.map((wave) =>
    wave.resources.map((entry) => [
      wave.hop,
      entry.resource,
      entry.via.confidence,
      entry.recoverable,
      entry.reasons.join('+'),
    ]),
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
const call = (seq: number, name: string, patch: Partial<Event> = {}): Event[] => [
  ev(seq, {
    kind: 'tool.call',
    spanId: `s${String(seq)}`,
    attrs: { 'gen_ai.tool.name': name },
    ...patch,
  }),
  ev(seq + 1, { kind: 'tool.result', spanId: `s${String(seq)}` }),
];

describe('blastRadius on the demo run', () => {
  const events = demoRunFixture();
  const graph = reconstruct(events, DEMO_RUN_ID);
  const deleteTool = graph.nodes.filter((node) => node.label === 'deleteVolume').at(-1)!.id;
  const rotateTool = graph.nodes.find((node) => node.label === 'rotateCredential')!.id;

  it('ripples from deleteVolume in two waves, volume then backups, unrecoverable', () => {
    const blast = blastRadius(graph, deleteTool, events);
    expect(blast).toEqual(blastGolden);
    expect(shape(blast)).toEqual([
      [
        [
          1,
          'projects/nova/volumes/vol-prod-01',
          'exact',
          false,
          'backups-deleted+irreversible-operation',
        ],
      ],
      [
        [
          2,
          'projects/nova/volumes/vol-prod-01/backups',
          'exact',
          false,
          'backups-deleted+irreversible-operation',
        ],
      ],
    ]);
    expect(blast.recoverable).toBe(false);
    expect(blast.groups).toEqual({
      orbital: [
        'resource:orbital:projects/nova/volumes/vol-prod-01',
        'resource:orbital:projects/nova/volumes/vol-prod-01/backups',
      ],
    });
    expect(blast.minConfidence).toBe('strong');
  });

  it('adds the backups node once, attached to the volume by the observed change', () => {
    const base = buildGraph(events, { runId: DEMO_RUN_ID });
    expect(graph.nodes).toHaveLength(base.nodes.length + 1);
    const backups = graph.nodes.at(-1);
    expect(backups).toMatchObject({
      id: 'resource:orbital:projects/nova/volumes/vol-prod-01/backups',
      type: 'resource',
      label: 'projects/nova/volumes/vol-prod-01/backups',
    });
    expect(withConsequences(graph, events)).toEqual(graph);
  });

  it('marks the credential rotation as recoverable', () => {
    const blast = blastRadius(graph, rotateTool, events);
    expect(shape(blast)).toEqual([
      [
        [
          1,
          'projects/nova/environments/staging/credentials/DATABASE_URL',
          'exact',
          true,
          'reversible-operation',
        ],
      ],
    ]);
    expect(blast.recoverable).toBe(true);
  });

  it('includes a weakly linked decoy only when weak edges are toggled on', () => {
    const original = events.find(
      (event) => event.kind === 'world.change' && event.target?.operation === 'deleteVolume',
    )!;
    const later = new Date(Date.parse(original.sourceTs) + 5000).toISOString();
    const decoy: Event = {
      ...original,
      id: ulid(900),
      seq: 900,
      ts: later,
      sourceTs: later,
      target: {
        system: 'orbital',
        resource: 'projects/nova/services/api',
        environment: 'production',
        operation: 'restartService',
        risk: 'medium',
      },
      attrs: { 'world.field': 'restarts', 'world.before': 0, 'world.after': 1 },
    };
    const all = [...events, decoy];
    const withDecoy = reconstruct(all, DEMO_RUN_ID);
    expect(shape(blastRadius(withDecoy, deleteTool, all))).toEqual(
      shape(blastRadius(graph, deleteTool, events)),
    );
    const weak = blastRadius(withDecoy, deleteTool, all, { includeWeak: true });
    expect(weak.minConfidence).toBe('weak');
    expect(shape(weak)).toEqual([
      [
        [
          1,
          'projects/nova/volumes/vol-prod-01',
          'exact',
          false,
          'backups-deleted+irreversible-operation',
        ],
        [1, 'projects/nova/services/api', 'weak', true, 'reversible-operation'],
      ],
      [
        [
          2,
          'projects/nova/volumes/vol-prod-01/backups',
          'exact',
          false,
          'backups-deleted+irreversible-operation',
        ],
      ],
    ]);
    expect(weak.recoverable).toBe(false);
  });

  it('is empty from a node with no outgoing mutations', () => {
    const blast = blastRadius(graph, 'agent:coding-agent', events);
    expect(blast).toEqual({
      origin: 'agent:coding-agent',
      minConfidence: 'strong',
      waves: [],
      groups: {},
      recoverable: true,
    });
  });
});

describe('recoverability from world metadata', () => {
  it('reads backups kept, irreversible and read-only verdicts', () => {
    const tokY = { principalId: 'human:pat', tokenRef: 'tok-y' };
    const tokZ = { principalId: 'human:pat', tokenRef: 'tok-z' };
    const events = [
      ...call(0, 'deleteVolume'),
      world(1, {
        attrs: { 'world.field': 'backupExists', 'world.before': true, 'world.after': true },
      }),
      ...call(10, 'listBuckets', {
        target: { system: 'orbital', resource: 'projects/p/buckets', operation: 'listBuckets' },
      }),
      ...call(20, 'dropTable', {
        target: { system: 'pg', resource: 'public.users', operation: 'dropTable' },
      }),
      ...call(30, 'scaleService', { authority: tokY }),
      world(31, {
        target: { system: 'orbital', resource: 'projects/p/services/s' },
        authority: tokY,
        attrs: { 'world.operation': 'scaleService' },
      }),
      ...call(40, 'stat', { authority: tokZ }),
      world(41, {
        target: { system: 'orbital', resource: 'projects/p/files/f' },
        authority: tokZ,
        attrs: { 'world.operation': 7 },
      }),
    ];
    const graph = reconstruct(events);
    const at = (seq: number): BlastRadius => blastRadius(graph, `tool:${ulid(seq)}`, events);
    expect(shape(at(0))).toEqual([
      [[1, 'projects/p/volumes/v', 'strong', true, 'irreversible-operation+backup-exists']],
    ]);
    expect(shape(at(10))).toEqual([[[1, 'projects/p/buckets', 'strong', true, 'read-only']]]);
    expect(shape(at(20))).toEqual([
      [[1, 'public.users', 'strong', false, 'irreversible-operation']],
    ]);
    expect(shape(at(30))).toEqual([
      [[1, 'projects/p/services/s', 'strong', true, 'reversible-operation']],
    ]);
    expect(shape(at(40))).toEqual([
      [[1, 'projects/p/files/f', 'strong', true, 'reversible-operation']],
    ]);
  });

  it('treats edges whose events are unknown as reversible mutations', () => {
    const events = [...call(0, 'deleteVolume'), world(2)];
    const graph = reconstruct(events);
    const blast = blastRadius(graph, `tool:${ulid(0)}`, events.slice(0, 2));
    expect(shape(blast)).toEqual([
      [[1, 'projects/p/volumes/v', 'strong', true, 'reversible-operation']],
    ]);
  });
});

describe('withConsequences and traversal', () => {
  it('derives backup nodes only from changes that lost backups on a known resource', () => {
    const events = [
      ...call(0, 'deleteVolume'),
      world(1, { attrs: { 'world.backupsDeleted': 2 } }),
      world(2, { attrs: { 'world.backupsDeleted': 1 } }),
      world(3, {
        target: { system: 'orbital', resource: 'projects/p/volumes/w', operation: 'deleteVolume' },
        attrs: { 'world.field': 'backupExists', 'world.after': false },
      }),
      world(4, {
        target: { system: 'orbital', resource: 'projects/p/volumes/x', operation: 'deleteVolume' },
      }),
      world(5, {
        target: { system: 'orbital', operation: 'deleteVolume' },
        attrs: { 'world.backupsDeleted': 3 },
      }),
      ev(6, { kind: 'error' }),
    ];
    const base = buildGraph(events);
    const graph = withConsequences(base, events);
    expect(graph.nodes.map((node) => node.id).filter((id) => id.endsWith('/backups'))).toEqual([
      'resource:orbital:projects/p/volumes/v/backups',
      'resource:orbital:projects/p/volumes/w/backups',
    ]);
    const orphan = world(7, {
      target: {
        system: 'orbital',
        resource: 'projects/p/volumes/ghost',
        operation: 'deleteVolume',
      },
      attrs: { 'world.backupsDeleted': 1 },
    });
    expect(withConsequences(base, [...events, orphan]).nodes).toHaveLength(graph.nodes.length);
  });

  it('visits each resource once, skips non-resource targets, and groups by system', () => {
    const events = [
      ...call(0, 'deleteVolume'),
      world(1),
      world(2, { target: { system: 'pg', resource: 'public.users', operation: 'deleteRows' } }),
    ];
    const graph = reconstruct(events);
    const tool = `tool:${ulid(0)}`;
    const extra: GraphEdge[] = [
      {
        from: 'resource:orbital:projects/p/volumes/v',
        to: 'resource:pg:public.users',
        type: 'observes',
        confidence: 'exact',
        eventIds: [ulid(1)],
      },
      {
        from: 'resource:pg:public.users',
        to: 'resource:orbital:projects/p/volumes/v',
        type: 'mutates',
        confidence: 'exact',
        eventIds: [ulid(2)],
      },
      { from: tool, to: 'agent:worker', type: 'mutates', confidence: 'exact', eventIds: [ulid(1)] },
      {
        from: tool,
        to: 'resource:nowhere:x',
        type: 'mutates',
        confidence: 'exact',
        eventIds: [ulid(1)],
      },
    ];
    const blast = blastRadius({ ...graph, edges: [...graph.edges, ...extra] }, tool, events);
    expect(shape(blast)).toEqual([
      [[1, 'projects/p/volumes/v', 'strong', false, 'irreversible-operation']],
      [[2, 'public.users', 'exact', false, 'irreversible-operation']],
    ]);
    expect(blast.groups).toEqual({
      orbital: ['resource:orbital:projects/p/volumes/v'],
      pg: ['resource:pg:public.users'],
    });
  });
});
