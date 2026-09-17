import { describe, expect, it } from 'vitest';

import type { Divergence } from './api';
import { markersFor } from './markers';

describe('markersFor', () => {
  it('maps divergence points to scrubber markers and rings the freeze frame', () => {
    const point = (eventId: string, ruleId?: string) => ({
      eventId,
      seq: 1,
      kind: 'tool.call',
      effect: 'require_approval' as const,
      explanation: 'x',
      ...(ruleId === undefined ? {} : { ruleId }),
    });
    const divergence: Divergence = {
      runId: 'r',
      evaluated: 3,
      points: [point('a', 'prod-guard'), point('b'), point('missing', 'r')],
      freezeFrame: point('a', 'prod-guard'),
    };
    const times: Record<string, number> = { a: 100, b: 250 };
    expect(markersFor(divergence, (id) => times[id])).toEqual([
      { t: 100, kind: 'freeze', label: 'require_approval · prod-guard' },
      { t: 250, kind: 'divergence', label: 'require_approval · default' },
    ]);
    expect(markersFor({ ...divergence, freezeFrame: undefined, points: [] }, () => 0)).toEqual([]);
  });
});
