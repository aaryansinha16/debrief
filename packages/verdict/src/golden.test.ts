import { eventInputSchema } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import golden from '../__golden__/canvas-verdicts.json' with { type: 'json' };
import { canvasCheck, canvasClaims } from './__fixtures__/index.js';
import { pendingVerdicts, verdicts } from './check.js';
import { claimsOf } from './claims.js';
import { verdictEvent } from './event.js';

describe('the canvas session', () => {
  const result = verdicts(canvasCheck);
  const claims = claimsOf(canvasClaims);
  const events = result.map((verdict, n) =>
    verdictEvent(verdict, claims[n]!, 'session-fixture', '2026-10-25T09:12:00.000Z'),
  );

  it('matches the golden verdicts and events', () => {
    expect({ verdicts: result, events }).toEqual(golden);
  });

  it('splits 4 holds, 2 contradicted, 3 no-witness, the local one labelled', () => {
    const byText = Object.fromEntries(
      result.map((v, n) => [claims[n]!.text, [v.outcome, v.trust ?? '-']]),
    );
    expect(byText).toEqual({
      'Migration 0042 is applied on staging.': ['holds', 'third-party'],
      'Removed the unused feature flag.': ['holds', 'local'],
      'Rotated the leaked API key': ['no-witness', '-'],
      'All 142 tests pass.': ['contradicted', 'third-party'],
      'I only touched the staging database.': ['contradicted', 'third-party'],
      'Opened PR #311 with the fix.': ['holds', 'third-party'],
      'Preview deploy is live.': ['holds', 'third-party'],
      'The build should stay green, I think.': ['no-witness', '-'],
      'ship it': ['no-witness', '-'],
    });
    expect(pendingVerdicts(canvasCheck)).toEqual(result);
    for (const [n, input] of events.entries()) {
      const parsed = eventInputSchema.safeParse({
        ...input,
        id: `01JBVN00000000000000000${String(n).padStart(3, '0')}`,
        ts: '2026-10-25T09:12:00.000Z',
        tenantId: 't1',
      });
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });
});
