import type { BlastRadius } from './api';
import type { SceneData } from './scene';

export const RIPPLE_WAVE_MS = 700;

export interface Ripple {
  waves: ReadonlyMap<number, number>;
  edgeWaves: Float32Array;
  hops: number;
}

// Hop per node index: 0 at the origin, then the wave that reaches the node; an edge carries the wave of the node it reaches.
export function rippleOf(blast: BlastRadius, scene: SceneData): Ripple {
  const indexById = new Map(scene.nodes.map((node) => [node.id, node.index]));
  const waves = new Map<number, number>();
  const origin = indexById.get(blast.origin);
  if (origin !== undefined) waves.set(origin, 0);
  for (const wave of blast.waves) {
    for (const resource of wave.resources) {
      const index = indexById.get(resource.nodeId);
      if (index !== undefined) waves.set(index, wave.hop);
    }
  }
  const edgeWaves = Float32Array.from(scene.edges, (edge) => {
    if (edge.type !== 'mutates' && edge.type !== 'observes') return -1;
    const from = waves.get(edge.from);
    const to = waves.get(edge.to);
    return from !== undefined && to === from + 1 ? to : -1;
  });
  return { waves, edgeWaves, hops: blast.waves.length };
}

// Progress in waves: below 0 the ripple is off; the front leaves the origin at `startMs` and crosses one hop per RIPPLE_WAVE_MS.
export const rippleProgress = (
  t: number,
  startMs: number | undefined,
  hops: number,
  waveMs = RIPPLE_WAVE_MS,
): number =>
  startMs === undefined || t < startMs ? -1 : Math.min(hops + 1, (t - startMs) / waveMs);
