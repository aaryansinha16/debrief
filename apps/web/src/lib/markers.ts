import type { ScrubberMarker } from '@debrief/ui';

import type { Divergence } from './api';

// One marker per divergence point; the freeze frame gets its ring.
export function markersFor(
  divergence: Divergence,
  timeOf: (eventId: string) => number | undefined,
): ScrubberMarker[] {
  return divergence.points.flatMap((point) => {
    const t = timeOf(point.eventId);
    if (t === undefined) return [];
    const kind = divergence.freezeFrame?.eventId === point.eventId ? 'freeze' : 'divergence';
    return [{ t, kind, label: `${point.effect} · ${point.ruleId ?? 'default'}` }];
  });
}
