import type { Event } from '@debrief/schema';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { canvasCheck } from './__fixtures__/index.js';
import { verdicts } from './check.js';
import { observedIn } from './select.js';

const { events, window } = canvasCheck;
const expected = verdicts(canvasCheck);
const observedIds = new Set(observedIn(events, window).map((e) => e.id));

describe('verdict properties', () => {
  it('gives the same verdicts for any order and any duplication of the events', () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray([...events], { minLength: events.length }),
        fc.array(fc.nat(events.length - 1), { maxLength: 12 }),
        (shuffled, extra) => {
          const doubled: Event[] = [...shuffled, ...extra.map((n) => events[n]!)];
          expect(verdicts({ events: doubled, window })).toEqual(expected);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('cites only observed events inside the window, at least one unless no-witness', () => {
    for (const verdict of expected) {
      if (verdict.outcome !== 'no-witness') {
        expect(verdict.evidence.length).toBeGreaterThan(0);
        expect(verdict.trust).toBeDefined();
      }
      for (const id of verdict.evidence) expect(observedIds.has(id)).toBe(true);
      expect(verdict.evidence).toEqual([...new Set(verdict.evidence)].sort());
    }
  });

  it('turns every verdict into no-witness once the observed events are gone or outside the window', () => {
    const silent = verdicts({ events: events.filter((e) => e.provenance !== 'observed'), window });
    expect(silent.map((v) => v.outcome)).toEqual(expected.map(() => 'no-witness'));
    expect(silent.every((v) => v.evidence.length === 0 && v.trust === undefined)).toBe(true);
    const elsewhere = verdicts({
      events,
      window: { from: '2026-10-26T00:00:00.000Z', to: '2026-10-26T01:00:00.000Z' },
    });
    expect(elsewhere.every((v) => v.outcome === 'no-witness')).toBe(true);
    fc.assert(
      fc.property(fc.subarray(events.filter((e) => e.provenance === 'observed')), (kept) => {
        const result = verdicts({
          events: [...events.filter((e) => e.provenance !== 'observed'), ...kept],
          window,
        });
        const keptIds = new Set(kept.map((e) => e.id));
        for (const verdict of result) {
          for (const id of verdict.evidence) expect(keptIds.has(id)).toBe(true);
          if (verdict.outcome !== 'no-witness') expect(verdict.evidence.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 80 },
    );
  });
});
