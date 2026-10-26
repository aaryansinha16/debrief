import { eventInputSchema } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import golden from '../__golden__/canvas-claims.json' with { type: 'json' };
import { canvasSession } from './__fixtures__/index.js';
import { claimEvent } from './event.js';
import { extractClaims, rereads } from './extract.js';

describe('the canvas session', () => {
  const extraction = extractClaims(canvasSession.reply, canvasSession.messages);
  const events = extraction.claims.map((claim) => claimEvent(claim, canvasSession.id));

  it('matches the golden claims and events', () => {
    expect({ extraction, events }).toEqual(golden);
  });

  it('re-reads every span, marks the hedge and counts what it dropped', () => {
    expect(extraction.claims).toHaveLength(8);
    expect(extraction.claims.every((claim) => rereads(claim, canvasSession.messages))).toBe(true);
    expect(
      extraction.claims.filter((claim) => claim.modality === 'hedged').map((c) => c.text),
    ).toEqual(['The build should stay green, I think.']);
    expect(extraction.dropped).toMatchObject({ 'unknown-message': 1, 'quote-not-found': 1 });
    for (const [n, input] of events.entries()) {
      const parsed = eventInputSchema.safeParse({
        ...input,
        id: `01JBCN00000000000000000${String(n).padStart(3, '0')}`,
        ts: '2026-10-25T09:00:00.000Z',
        tenantId: 't1',
      });
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });
});
