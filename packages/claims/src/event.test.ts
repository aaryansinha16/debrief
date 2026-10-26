import { eventInputSchema } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import { claimEvent, claimSpan, overlapsAny } from './event.js';
import type { Claim } from './extract.js';

const claim: Claim = {
  text: 'Opened PR #311 with the fix.',
  span: { messageId: '01JB2W6Q8R0S1T2V3W4X5Y6Z7A', start: 4, end: 32 },
  saidAt: '2026-10-25T14:30:11.000+05:30',
  modality: 'asserted',
  predicate: 'pr.opened',
  subject: { system: 'github', resource: 'acme/billing-api' },
  params: { number: 311 },
};

describe('claimEvent', () => {
  it('encodes a claim as a derived event the schema accepts', () => {
    const input = claimEvent(claim, 'session-1');
    expect(input).toEqual({
      source: 'api',
      provenance: 'derived',
      kind: 'claim',
      runId: 'session-1',
      sourceTs: '2026-10-25T14:30:11.000+05:30',
      actor: { type: 'system', id: 'debrief-claims' },
      target: { system: 'github', resource: 'acme/billing-api' },
      attrs: {
        'claim.text': 'Opened PR #311 with the fix.',
        'claim.span.message_id': '01JB2W6Q8R0S1T2V3W4X5Y6Z7A',
        'claim.span.start': 4,
        'claim.span.end': 32,
        'claim.modality': 'asserted',
        'claim.predicate': 'pr.opened',
        'claim.param.number': 311,
      },
      summary: 'claim pr.opened (asserted)',
    });
    const parsed = eventInputSchema.safeParse({
      ...input,
      id: '01JB2W6Q8R0S1T2V3W4X5Y6Z7B',
      ts: '2026-10-26T09:00:00.000Z',
      tenantId: 't1',
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('reads a stored claim’s span back and tells overlapping spans in the same message', () => {
    const span = claimSpan(claimEvent(claim, 's').attrs);
    expect(span).toEqual(claim.span);
    expect(
      claimSpan({ 'claim.span.message_id': 'm', 'claim.span.start': '0', 'claim.span.end': 1 }),
    ).toBeUndefined();
    expect(overlapsAny({ ...claim.span, start: 30, end: 40 }, [claim.span])).toBe(true);
    expect(overlapsAny({ ...claim.span, start: 32, end: 40 }, [claim.span])).toBe(false);
    expect(overlapsAny({ ...claim.span, messageId: 'other' }, [claim.span])).toBe(false);
  });
});
