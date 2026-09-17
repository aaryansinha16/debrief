import { PROD_GUARD_YAML, parsePolicy } from '@debrief/policy';
import {
  blastRadius,
  divergence,
  layout as layoutGraph,
  reconstructGraph,
} from '@debrief/reconstruct';
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { describe, expect, it } from 'vitest';

import { RIPPLE_WAVE_MS, rippleOf, rippleProgress } from './ripple';
import { buildSceneData } from './scene';

describe('rippleOf', () => {
  const events = demoRunFixture();
  const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
  const scene = buildSceneData(graph, layoutGraph(graph, 'ripple-test'), events);
  const origin = divergence(events, parsePolicy(PROD_GUARD_YAML), graph).freezeFrame!.nodeId!;
  const volume = 'resource:orbital:projects/nova/volumes/vol-prod-01';
  const blast = blastRadius(graph, origin, events);
  const indexOf = (id: string): number => scene.nodes.find((node) => node.id === id)!.index;

  it('numbers the origin 0 and each resource by the wave that reaches it', () => {
    const ripple = rippleOf(blast, scene);
    expect(ripple.waves.get(indexOf(origin))).toBe(0);
    expect(ripple.waves.get(indexOf(volume))).toBe(1);
    expect(ripple.waves.get(indexOf(`${volume}/backups`))).toBe(2);
    expect(ripple.hops).toBe(blast.waves.length);
    expect(ripple.waves.size).toBe(
      1 + blast.waves.reduce((n, wave) => n + wave.resources.length, 0),
    );
  });

  it('lights only the edges the front travels along, in the wave of the node they reach', () => {
    const ripple = rippleOf(blast, scene);
    expect(ripple.edgeWaves).toHaveLength(scene.edges.length);
    const lit = [...ripple.edgeWaves]
      .map((wave, position) => ({ wave, edge: scene.edges[position]! }))
      .filter(({ wave }) => wave >= 0);
    expect(lit.length).toBeGreaterThan(0);
    for (const { wave, edge } of lit) {
      expect(edge.type === 'mutates' || edge.type === 'observes').toBe(true);
      expect(ripple.waves.get(edge.to)).toBe(wave);
      expect(ripple.waves.get(edge.from)).toBe(wave - 1);
    }
    expect(
      lit.some(({ edge }) => edge.from === indexOf(origin) && edge.to === indexOf(volume)),
    ).toBe(true);
  });

  it('leaves the scene dark when the origin is not on the stage', () => {
    const ripple = rippleOf({ ...blast, origin: 'tool:elsewhere', waves: [] }, scene);
    expect(ripple.waves.size).toBe(0);
    expect(ripple.hops).toBe(0);
    expect([...ripple.edgeWaves].every((wave) => wave === -1)).toBe(true);
  });
});

describe('rippleProgress', () => {
  it('is off before the start, then advances one wave per RIPPLE_WAVE_MS up to hops + 1', () => {
    expect(rippleProgress(5, undefined, 2)).toBe(-1);
    expect(rippleProgress(100, 200, 2)).toBe(-1);
    expect(rippleProgress(200, 200, 2)).toBe(0);
    expect(rippleProgress(200 + RIPPLE_WAVE_MS, 200, 2)).toBe(1);
    expect(rippleProgress(200 + RIPPLE_WAVE_MS * 1.5, 200, 2)).toBe(1.5);
    expect(rippleProgress(99_999, 200, 2)).toBe(3);
    expect(rippleProgress(300, 200, 2, 100)).toBe(1);
  });
});
