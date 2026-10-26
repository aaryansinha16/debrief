import { describe, expect, it } from 'vitest';

import { type TranscriptMessage, extractClaims, rereads } from './extract.js';
import type { ReplyClaim } from './reply.js';

const messages: TranscriptMessage[] = [
  {
    id: 'm1',
    saidAt: '2026-10-26T09:15:02.000Z',
    text: '🚀 Done. All 142 tests pass. All 142 tests pass.',
  },
  {
    id: 'm2',
    saidAt: '2026-10-26T09:16:00.000Z',
    text: 'The build should pass now. I think staging is fine.',
  },
];

const claim = (patch: Partial<ReplyClaim>): ReplyClaim => ({
  message_id: 'm1',
  quote: 'All 142 tests pass.',
  modality: 'asserted',
  predicate: 'tests.passed',
  subject: { system: ' GitHub ', resource: null, environment: null, operation: null },
  params: [{ name: 'passed', value: '142' }],
  ...patch,
});

describe('extractClaims', () => {
  it('locates each quote as a UTF-16 span that re-reads, the next free occurrence for a repeat', () => {
    const { claims, dropped } = extractClaims({ claims: [claim({}), claim({})] }, messages);
    expect(claims.map((c) => c.span)).toEqual([
      { messageId: 'm1', start: 9, end: 28 },
      { messageId: 'm1', start: 29, end: 48 },
    ]);
    expect(claims[0]).toEqual({
      text: 'All 142 tests pass.',
      span: { messageId: 'm1', start: 9, end: 28 },
      saidAt: '2026-10-26T09:15:02.000Z',
      modality: 'asserted',
      predicate: 'tests.passed',
      subject: { system: 'github' },
      params: { passed: 142 },
    });
    expect(claims.every((c) => rereads(c, messages))).toBe(true);
    expect(Object.values(dropped).every((n) => n === 0)).toBe(true);
  });

  it('drops and counts claims it cannot place, and a third repeat with no free occurrence', () => {
    const { claims, dropped } = extractClaims(
      {
        claims: [
          claim({ message_id: 'user-1' }),
          claim({ quote: '   ' }),
          claim({ quote: 'x'.repeat(1001) }),
          claim({ quote: 'All 143 tests pass.' }),
          claim({}),
          claim({}),
          claim({}),
        ],
      },
      messages,
    );
    expect(claims).toHaveLength(2);
    expect(dropped).toEqual({
      'unknown-message': 1,
      'empty-quote': 1,
      'quote-too-long': 1,
      'quote-not-found': 1,
      repeated: 1,
    });
  });

  it('marks hedges hedged whatever the model said, and sorts by message and position', () => {
    const { claims } = extractClaims(
      {
        claims: [
          claim({ message_id: 'm2', quote: 'I think staging is fine.', predicate: 'db.scope' }),
          claim({ message_id: 'm2', quote: 'The build should pass now.', predicate: 'ci.passed' }),
          claim({
            quote: 'Done.',
            predicate: 'feeling.good',
            params: [{ name: 'mood', value: 'ok' }],
          }),
        ],
      },
      messages,
    );
    expect(claims.map((c) => [c.span.messageId, c.text, c.modality, c.predicate])).toEqual([
      ['m1', 'Done.', 'asserted', 'unchecked'],
      ['m2', 'The build should pass now.', 'hedged', 'ci.passed'],
      ['m2', 'I think staging is fine.', 'hedged', 'db.scope'],
    ]);
    expect(claims[0]!.params).toEqual({});
  });

  it('keeps the subject fields the model gave and refuses a span that does not re-read', () => {
    const [placed] = extractClaims(
      {
        claims: [
          claim({
            subject: {
              system: '',
              resource: ' invoices ',
              environment: 'staging',
              operation: ' update ',
            },
          }),
        ],
      },
      messages,
    ).claims;
    expect(placed!.subject).toEqual({
      system: 'unknown',
      resource: 'invoices',
      environment: 'staging',
      operation: 'update',
    });
    expect(
      rereads({ text: 'All 142', span: { messageId: 'm1', start: 0, end: 7 } }, messages),
    ).toBe(false);
    expect(rereads({ text: 'x', span: { messageId: 'gone', start: 0, end: 1 } }, messages)).toBe(
      false,
    );
  });
});
