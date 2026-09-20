import { reconstructGraph } from '@debrief/reconstruct';
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { createReplay } from '@debrief/ui';
import { describe, expect, it } from 'vitest';

import type { CausalGraph } from './api';
import { MAP_HEIGHT, MAP_WIDTH, mapFrame, mapLayout, shortLabel } from './map-layout';

const events = demoRunFixture();
const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
const layout = mapLayout(graph, events);
const order = createReplay(events).events.map((entry) => entry.event.id);

describe('mapLayout', () => {
  it('groups calls to the same tool or model and places every node inside its zone', () => {
    const labels = layout.nodes.map((node) => `${node.zone}/${node.label}`);
    expect(labels.filter((label) => label.startsWith('model/'))).toHaveLength(1);
    expect(labels.filter((label) => label.startsWith('tools/'))).toEqual([
      'tools/listVolumes',
      'tools/rotateCredential',
      'tools/deleteVolume',
      'tools/readFile',
    ]);
    expect(labels).toContain('people/Aaryan');
    expect(labels).toContain('agent/coding-agent');
    expect(labels).toContain('tokens/legacy migration token');
    expect(labels.filter((label) => label.startsWith('production/'))).toHaveLength(2);
    expect(labels.filter((label) => label.startsWith('staging/'))).toHaveLength(1);
    expect(layout.zones.map((zone) => zone.id)).toEqual([
      'people',
      'model',
      'agent',
      'tokens',
      'tools',
      'systems',
      'staging',
      'production',
    ]);
    for (const zone of layout.zones) {
      expect(zone.x).toBeGreaterThanOrEqual(0);
      expect(zone.x + zone.width).toBeLessThanOrEqual(MAP_WIDTH);
      expect(zone.y + zone.height).toBeLessThanOrEqual(MAP_HEIGHT);
      for (const id of zone.nodeIds) {
        const node = layout.nodes.find((candidate) => candidate.id === id);
        expect(node?.zone).toBe(zone.id);
        expect(node!.x).toBeGreaterThan(zone.x);
        expect(node!.y).toBeGreaterThan(zone.y);
        expect(node!.y).toBeLessThan(zone.y + zone.height);
      }
    }
    const model = layout.nodes.find((node) => node.zone === 'model');
    expect(model?.graphIds.length).toBe(9);
    expect(layout.nodeOf(model!.graphIds[3]!)).toBe(model);
    expect(layout.nodeOf('nope')).toBeUndefined();
  });

  it('merges parallel graph edges and drops self loops', () => {
    const ids = layout.edges.map((edge) => edge.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('agent:coding-agent→tool:deleteVolume:calls');
    expect(
      layout.edges.find((edge) => edge.id === 'agent:coding-agent→tool:deleteVolume:calls')
        ?.eventIds,
    ).toHaveLength(2);
    expect(layout.edges.some((edge) => edge.from === edge.to)).toBe(false);
    const dangling: CausalGraph = {
      ...graph,
      edges: [
        {
          from: 'ghost',
          to: 'agent:coding-agent',
          type: 'calls',
          confidence: 'weak',
          eventIds: [],
        },
      ],
    };
    expect(mapLayout(dangling, events).edges).toEqual([]);
  });

  it('scales a crowded column down to the stage height', () => {
    const crowded: CausalGraph = {
      ...graph,
      nodes: Array.from({ length: 40 }, (_, n) => ({
        id: `tool:t${String(n)}`,
        type: 'tool' as const,
        label: `tool-${String(n)}`,
        ts: '2026-09-17T00:00:00Z',
        eventIds: [],
      })),
      edges: [],
    };
    const tall = mapLayout(crowded, []);
    const tools = tall.zones.find((zone) => zone.id === 'tools');
    expect(tools?.height).toBeLessThanOrEqual(MAP_HEIGHT);
    const sparse = layout.zones.find((zone) => zone.id === 'systems');
    expect(sparse?.height).toBeCloseTo(MAP_HEIGHT - 24);
    const people = layout.zones.find((zone) => zone.id === 'people')!;
    const model = layout.zones.find((zone) => zone.id === 'model')!;
    expect(people.y + people.height + 12).toBeCloseTo(model.y);
    expect(model.y + model.height).toBeCloseTo(MAP_HEIGHT - 12);
    expect(tall.nodes.every((node) => node.y < MAP_HEIGHT)).toBe(true);
    expect(tall.nodes.every((node) => node.zone === 'tools')).toBe(true);
    const unknown: CausalGraph = {
      ...graph,
      nodes: [
        {
          id: 'resource:x',
          type: 'resource',
          label: 'a/b/c/d',
          ts: '2026-09-17T00:00:00Z',
          eventIds: ['nope'],
        },
        {
          id: 'policy:p',
          type: 'policy',
          label: 'prod-guard',
          ts: '2026-09-17T00:00:00Z',
          eventIds: [],
        },
        { id: 'human:h', type: 'human', label: 'H', ts: '2026-09-17T00:00:00Z', eventIds: [] },
        { id: 'sub:s', type: 'subagent', label: 'S', ts: '2026-09-17T00:00:00Z', eventIds: [] },
      ],
      edges: [],
    };
    expect(mapLayout(unknown, events).nodes.map((node) => node.zone)).toEqual([
      'resources',
      'policy',
      'people',
      'agent',
    ]);
  });

  it('shortens resource paths and cuts long labels', () => {
    expect(shortLabel({ type: 'resource', label: 'projects/nova/volumes/vol-prod-01' })).toBe(
      'volumes/vol-prod-01',
    );
    expect(shortLabel({ type: 'resource', label: 'a/b' })).toBe('a/b');
    expect(shortLabel({ type: 'tool', label: 'projects/x/y' })).toBe('projects/x/y');
    expect(shortLabel({ type: 'grant', label: 'coding-agent staging deploy token' })).toBe(
      'coding-agent staging de…',
    );
  });
});

describe('mapFrame', () => {
  it('lights nodes and edges as events apply and rests the cursor where the action landed', () => {
    const start = mapFrame(layout, order, 0);
    expect(start.touched.size).toBe(0);
    expect(start.cursor).toBeUndefined();
    expect(start.currentEventId).toBeUndefined();
    const first = mapFrame(layout, order, 1);
    expect(first.currentEventId).toBe(order[0]);
    expect(first.currentNodes.size).toBeGreaterThan(0);
    expect(first.cursor).toBeDefined();
    const deletion = events.filter(
      (event) => event.kind === 'tool.call' && event.target?.operation === 'deleteVolume',
    );
    const at = order.indexOf(deletion.at(-1)!.id) + 1;
    const frame = mapFrame(layout, order, at);
    expect(frame.currentEdges.size).toBeGreaterThan(0);
    expect(frame.cursor).toBe('tool:deleteVolume');
    expect(frame.traversed.size).toBeGreaterThan(first.traversed.size);
    expect(frame.touched.has('tool:deleteVolume')).toBe(true);
    const all = mapFrame(layout, order, order.length);
    expect(all.touched.size).toBe(layout.nodes.length);
    expect(all.traversed.size).toBe(layout.edges.length);
  });

  it('is a pure function of the index: the cursor survives events that touch nothing', () => {
    const silent = {
      ...layout,
      edges: layout.edges.filter((edge) => !edge.eventIds.includes(order[3]!)),
      nodes: layout.nodes.map((node) => ({
        ...node,
        eventIds: node.eventIds.filter((id) => id !== order[3]),
      })),
    };
    const before = mapFrame(silent, order, 3);
    const during = mapFrame(silent, order, 4);
    expect(during.currentNodes.size).toBe(0);
    expect(during.cursor).toBe(before.cursor);
    expect(mapFrame({ ...layout, nodes: [], edges: [] }, order, 4).cursor).toBeUndefined();
    const nodeOnly = { ...layout, edges: [] };
    expect(mapFrame(nodeOnly, order, 1).cursor).toBe(
      [...mapFrame(nodeOnly, order, 1).currentNodes][0],
    );
  });
});
