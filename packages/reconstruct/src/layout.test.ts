import { describe, expect, it } from 'vitest';

import layoutGolden from '../__golden__/nine-seconds.layout.json';
import { DEMO_RUN_ID, demoRunFixture } from './__fixtures__/nine-seconds.js';
import { ev } from './__fixtures__/synthetic.js';
import { buildGraph } from './graph.js';
import { LAYERS, LAYOUT_ITERATIONS, LAYOUT_VERSION, layout } from './layout.js';
import { reconstructGraph } from './pipeline.js';

describe('layout on the demo run', () => {
  const events = demoRunFixture();
  const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });

  it('matches the golden and is identical for the same seed', () => {
    const first = layout(graph, 'nine-seconds');
    expect(first).toEqual(layoutGolden);
    expect(layout(graph, 'nine-seconds')).toEqual(first);
    expect(first).toMatchObject({
      version: LAYOUT_VERSION,
      seed: 'nine-seconds',
      iterations: LAYOUT_ITERATIONS,
    });
  });

  it('changes with the seed, places every node, rounds to 0.01 and layers by role', () => {
    const first = layout(graph, 'nine-seconds');
    const other = layout(graph, 'other-seed');
    expect(other.positions).not.toEqual(first.positions);
    expect(Object.keys(first.positions).sort()).toEqual(graph.nodes.map((node) => node.id).sort());
    for (const [id, position] of Object.entries(first.positions)) {
      expect(position.x).toBe(Math.round(position.x * 100) / 100);
      expect(position.y).toBe(Math.round(position.y * 100) / 100);
      expect(position.x).toBeGreaterThanOrEqual(first.bounds.min.x);
      expect(position.x).toBeLessThanOrEqual(first.bounds.max.x);
      expect(position.y).toBeGreaterThanOrEqual(first.bounds.min.y);
      expect(position.y).toBeLessThanOrEqual(first.bounds.max.y);
      const type = graph.nodes.find((node) => node.id === id)?.type ?? 'tool';
      expect(position.z).toBe(LAYERS[type]);
    }
    const ids = Object.keys(first.positions);
    const distinct = new Set(
      ids.map((id) => `${String(first.positions[id]?.x)},${String(first.positions[id]?.y)}`),
    );
    expect(distinct.size).toBe(ids.length);
  });

  it('lays out an empty graph and a single node without NaNs', () => {
    expect(layout(buildGraph([]), 'x')).toEqual({
      version: LAYOUT_VERSION,
      seed: 'x',
      iterations: LAYOUT_ITERATIONS,
      positions: {},
      bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
    });
    const single = layout(buildGraph([ev(0, { kind: 'error' })]), 'x');
    expect(single.positions['agent:worker']).toEqual({ x: 0, y: 0, z: 3 });
  });
});
