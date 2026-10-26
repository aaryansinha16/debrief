import type { Event } from '@debrief/schema';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { adversarial } from './__fixtures__/adversarial/index.js';
import { canvasCheck } from './__fixtures__/index.js';
import { verdicts } from './check.js';
import { claimsOf } from './claims.js';
import { observedIn, onSubject } from './select.js';
import type { CheckInput } from './types.js';

const sessions: { name: string; input: CheckInput }[] = [
  { name: 'canvas', input: canvasCheck },
  ...adversarial.map((f) => ({ name: f.name, input: { events: f.events, window: f.window } })),
];

describe.each(sessions)('verdict properties: $name', ({ input }) => {
  const { events, window } = input;
  const expected = verdicts(input);
  const observed = observedIn(events, window);
  const observedIds = new Set(observed.map((e) => e.id));
  const claims = claimsOf(events);

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
      { numRuns: 25 },
    );
  });

  it('cites only observed events on the subject inside the window, at least one unless no-witness', () => {
    for (const [n, verdict] of expected.entries()) {
      const claim = claims[n]!;
      const onSubjectIds = new Set(onSubject(claim, observed).map((e) => e.id));
      if (verdict.outcome !== 'no-witness') {
        expect(verdict.evidence.length).toBeGreaterThan(0);
        expect(verdict.trust).toBeDefined();
      } else {
        expect(verdict.trust).toBeUndefined();
      }
      for (const id of verdict.evidence) {
        expect(observedIds.has(id)).toBe(true);
        expect(onSubjectIds.has(id), `${claim.text} cites ${id} off its subject`).toBe(true);
        expect(id).not.toBe(claim.id);
      }
      expect(verdict.evidence).toEqual([...new Set(verdict.evidence)].sort());
      expect(verdict.evidence.length).toBeLessThanOrEqual(100);
      expect(Array.from(verdict.reason).length).toBeLessThanOrEqual(280);
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
      { numRuns: 25 },
    );
  });
});
