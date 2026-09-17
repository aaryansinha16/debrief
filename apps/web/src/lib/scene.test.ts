import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { layout as layoutGraph, reconstructGraph } from '@debrief/reconstruct';
import { COLORS } from '@debrief/ui';
import { describe, expect, it } from 'vitest';

import {
  LOD_NODE_THRESHOLD,
  NODE_COLORS,
  buildSceneData,
  edgesTouching,
  hexToRgb,
  provenanceOf,
  syntheticScene,
} from './scene';

describe('buildSceneData', () => {
  const events = demoRunFixture();
  const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
  const layout = layoutGraph(graph, 'scene-test');

  it('places every node, colours by type and marks observed nodes and edges', () => {
    const scene = buildSceneData(graph, layout, events);
    expect(scene.nodes).toHaveLength(graph.nodes.length);
    expect(scene.positions).toHaveLength(graph.nodes.length * 3);
    expect(scene.edges).toHaveLength(graph.edges.length);
    expect(scene.segments).toHaveLength(graph.edges.length * 6);
    const resource = scene.nodes.find((node) => node.type === 'resource')!;
    expect(resource).toMatchObject({ provenance: 'observed', color: COLORS.ember, radius: 3.5 });
    expect(resource.summary).toContain('Orbital');
    const agent = scene.nodes.find((node) => node.id === 'agent:coding-agent')!;
    expect(agent).toMatchObject({ provenance: 'reported', color: NODE_COLORS.agent });
    const observedEdges = scene.edges.filter((edge) => edge.provenance === 'observed');
    expect(observedEdges.length).toBeGreaterThan(0);
    expect(new Set(observedEdges.map((edge) => edge.type))).toEqual(
      new Set(['mutates', 'authorized_by']),
    );
    const first = scene.nodes[0]!;
    Array.from(scene.positions.slice(0, 3)).forEach((axis, index) => {
      expect(axis).toBeCloseTo(first.position[index] ?? Number.NaN, 3);
    });
    Array.from(scene.colors.slice(0, 3)).forEach((channel, index) => {
      expect(channel).toBeCloseTo(hexToRgb(first.color)[index] ?? Number.NaN, 3);
    });
    expect(scene.radii[0]).toBe(first.radius);
    expect(scene.radiusOfGraph).toBeGreaterThan(0);
    const backups = scene.nodes.find((node) => node.id.endsWith('/backups'))!;
    expect(backups.summary).toBeDefined();
  });

  it('falls back for nodes without layout or events and skips dangling edges', () => {
    const scene = buildSceneData(
      {
        ...graph,
        edges: [
          ...graph.edges,
          {
            from: 'ghost',
            to: graph.nodes[0]!.id,
            type: 'calls',
            confidence: 'weak',
            eventIds: [],
          },
        ],
      },
      { ...layout, positions: {} },
      [],
    );
    expect(scene.edges).toHaveLength(graph.edges.length);
    expect(scene.nodes.every((node) => node.position.every((axis) => axis === 0))).toBe(true);
    expect(scene.nodes.every((node) => node.provenance === 'reported')).toBe(true);
    expect(scene.nodes.every((node) => node.summary === undefined)).toBe(true);
    expect(scene.center).toEqual([0, 0, 0]);
    expect(scene.radiusOfGraph).toBe(0);
    const empty = buildSceneData(
      { runId: 'r', version: '1', nodes: [], edges: [] },
      { ...layout, positions: {} },
    );
    expect(empty.center).toEqual([0, 0, 0]);
    expect(empty.positions).toHaveLength(0);
  });

  it('derives provenance strictly and converts colours', () => {
    const byId = new Map(events.map((event) => [event.id, event]));
    const observed = events
      .filter((event) => event.provenance === 'observed')
      .map((event) => event.id);
    const reported = events
      .filter((event) => event.provenance === 'reported')
      .map((event) => event.id);
    expect(provenanceOf(observed, byId)).toBe('observed');
    expect(provenanceOf([...observed, reported[0]!], byId)).toBe('reported');
    expect(provenanceOf(['missing'], byId)).toBe('reported');
    expect(provenanceOf([], byId)).toBe('reported');
    expect(hexToRgb('#ff7a3d')).toEqual([1, 122 / 255, 61 / 255]);
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
  });

  it('generates a synthetic scene of the requested size', () => {
    const { graph: synthetic, layout: syntheticLayout } = syntheticScene(1000);
    expect(synthetic.nodes).toHaveLength(1000);
    expect(synthetic.edges).toHaveLength(999 + 499);
    expect(synthetic.edges[0]).toMatchObject({ from: 'n1', to: 'n0' });
    expect(synthetic.edges[2]).toMatchObject({ from: 'n2', to: 'n0' });
    expect(Object.keys(syntheticLayout.positions)).toHaveLength(1000);
    const scene = buildSceneData(synthetic, syntheticLayout);
    expect(scene.nodes).toHaveLength(1000);
    expect(scene.edges).toHaveLength(1498);
    expect(new Set(scene.nodes.map((node) => node.type)).size).toBe(5);
    expect(syntheticScene(1).graph.edges).toEqual([]);
    expect(LOD_NODE_THRESHOLD).toBe(1000);
  });

  it('extracts the edges touching one node for the far level of detail', () => {
    const { graph: synthetic, layout: syntheticLayout } = syntheticScene(50);
    const scene = buildSceneData(synthetic, syntheticLayout);
    const around = edgesTouching(scene, 10);
    const touching = scene.edges.filter((edge) => edge.from === 10 || edge.to === 10);
    expect(touching.length).toBeGreaterThan(1);
    expect(around.segments).toHaveLength(touching.length * 6);
    expect(Array.from(around.segments.slice(0, 6))).toEqual(
      Array.from(
        scene.segments.slice(
          scene.edges.indexOf(touching[0]!) * 6,
          scene.edges.indexOf(touching[0]!) * 6 + 6,
        ),
      ),
    );
    expect(around.segmentColors).toHaveLength(touching.length * 6);
    expect(edgesTouching(scene, undefined).segments).toHaveLength(0);
    expect(edgesTouching(scene, 999).segments).toHaveLength(0);
  });
});
