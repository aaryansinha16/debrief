import type { Replay } from '@debrief/ui';

export const FLARE_MS = 800;

// World changes flare their resource node: full strength at the event, fading over FLARE_MS; the same `t` drives the panel.
export function flaresAt(replay: Replay, t: number, windowMs = FLARE_MS): Map<string, number> {
  const flares = new Map<string, number>();
  const applied = replay.events.slice(0, replay.indexAt(t)).reverse();
  for (const entry of applied) {
    const age = t - entry.t;
    if (age > windowMs) break;
    const target = entry.event.target;
    if (entry.event.kind !== 'world.change' || target?.resource === undefined) continue;
    const id = `resource:${target.system}:${target.resource}`;
    flares.set(id, Math.max(flares.get(id) ?? 0, 1 - age / windowMs));
  }
  return flares;
}
