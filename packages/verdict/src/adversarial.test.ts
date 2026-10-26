import { describe, expect, it } from 'vitest';

import { adversarial } from './__fixtures__/adversarial/index.js';
import { verdicts } from './check.js';
import { claimsOf } from './claims.js';

// The claim-skeptic's fixtures: each claim's verdict must match what a careful human would give.
describe('adversarial fixtures', () => {
  for (const fixture of adversarial) {
    it(fixture.name, () => {
      const claims = claimsOf(fixture.events);
      const result = verdicts({ events: fixture.events, window: fixture.window });
      const got = Object.fromEntries(
        result.map((verdict, n) => [
          claims[n]!.text,
          verdict.trust === undefined
            ? { outcome: verdict.outcome }
            : { outcome: verdict.outcome, trust: verdict.trust },
        ]),
      );
      expect(got).toEqual(fixture.expected);
      for (const verdict of result) {
        if (verdict.outcome !== 'no-witness') expect(verdict.evidence.length).toBeGreaterThan(0);
      }
    });
  }
});
