import { describe, expect, it } from 'vitest';

import { eventInputSchema, eventKindSchema, eventSchema, type Event } from './event.js';

const zeros = '0'.repeat(64);
const hash = 'ab'.repeat(32);

const validEvent: Event = {
  id: '01J8ZK5R4M2X6P9Q3V7W1Y5N8B',
  tenantId: 'tenant-a',
  seq: 0,
  ts: '2026-09-17T00:00:00.000Z',
  sourceTs: '2026-09-17T00:00:00.000Z',
  source: 'otlp',
  provenance: 'reported',
  runId: '4bf92f3577b34da6a3ce929d0e0e4736',
  kind: 'agent.invoke',
  actor: { type: 'agent', id: 'coding-agent' },
  attrs: { 'gen_ai.agent.name': 'coding-agent', 'gen_ai.usage.input_tokens': 12, cached: false },
  prevHash: zeros,
  hash,
};

const withField = (patch: Record<string, unknown>): unknown => ({ ...validEvent, ...patch });

describe('eventSchema', () => {
  it('accepts a minimal valid event', () => {
    expect(eventSchema.parse(validEvent)).toEqual(validEvent);
  });

  it('accepts every optional field when well-formed', () => {
    const full = withField({
      spanId: '00f067aa0ba902b7',
      parentSpanId: '53995c3f42cd8ad8',
      authority: {
        principalId: 'human-1',
        grantId: 'grant-1',
        tokenRef: 'tok-1',
        scope: ['staging:credentials'],
        permissions: ['account:*'],
      },
      target: {
        system: 'orbital',
        resource: 'vol-prod-1',
        environment: 'production',
        operation: 'deleteVolume',
        risk: 'critical',
      },
      payloadSha256: hash,
      summary: 'x'.repeat(280),
    });
    expect(eventSchema.safeParse(full).success).toBe(true);
  });

  it('rejects unknown kinds', () => {
    expect(eventSchema.safeParse(withField({ kind: 'agent.think' })).success).toBe(false);
    expect(eventKindSchema.safeParse('tool.CALL').success).toBe(false);
  });

  it.each([
    '2026-09-17T00:00:00',
    '2026-09-17T00:00:00+05:30',
    '2026-09-17 00:00:00Z',
    '2026-09-17',
    '2026-13-01T00:00:00Z',
    '1758067200',
    '',
  ])('rejects malformed or non-UTC ts %j', (ts) => {
    expect(eventSchema.safeParse(withField({ ts })).success).toBe(false);
  });

  it('accepts an offset on sourceTs but still rejects garbage', () => {
    expect(
      eventSchema.safeParse(withField({ sourceTs: '2026-09-17T05:30:00+05:30' })).success,
    ).toBe(true);
    expect(eventSchema.safeParse(withField({ sourceTs: '2026-09-17T05:30:00' })).success).toBe(
      false,
    );
    expect(eventSchema.safeParse(withField({ sourceTs: 'yesterday' })).success).toBe(false);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '0'])('rejects seq %j', (seq) => {
    expect(eventSchema.safeParse(withField({ seq })).success).toBe(false);
  });

  it('accepts the largest safe seq', () => {
    expect(eventSchema.safeParse(withField({ seq: Number.MAX_SAFE_INTEGER })).success).toBe(true);
  });

  it.each([
    '01J8ZK5R4M2X6P9Q3V7W1Y5N8',
    '01j8zk5r4m2x6p9q3v7w1y5n8b',
    '81J8ZK5R4M2X6P9Q3V7W1Y5N8B',
  ])('rejects malformed ulid %j', (id) => {
    expect(eventSchema.safeParse(withField({ id })).success).toBe(false);
  });

  it.each(['prevHash', 'hash', 'payloadSha256'])('rejects non-hex or wrong-length %s', (field) => {
    expect(eventSchema.safeParse(withField({ [field]: 'AB'.repeat(32) })).success).toBe(false);
    expect(eventSchema.safeParse(withField({ [field]: 'ab'.repeat(31) })).success).toBe(false);
  });

  it('rejects unknown keys at every level', () => {
    expect(eventSchema.safeParse(withField({ extra: 1 })).success).toBe(false);
    expect(
      eventSchema.safeParse(withField({ actor: { type: 'agent', id: 'a', role: 'x' } })).success,
    ).toBe(false);
    expect(
      eventSchema.safeParse(withField({ target: { system: 's', region: 'eu' } })).success,
    ).toBe(false);
    expect(
      eventSchema.safeParse(withField({ authority: { principalId: 'p', extra: true } })).success,
    ).toBe(false);
  });

  it('rejects nested or null attrs values', () => {
    expect(eventSchema.safeParse(withField({ attrs: { nested: { a: 1 } } })).success).toBe(false);
    expect(eventSchema.safeParse(withField({ attrs: { list: [1] } })).success).toBe(false);
    expect(eventSchema.safeParse(withField({ attrs: { nil: null } })).success).toBe(false);
  });

  it('rejects a summary over 280 chars and empty ids', () => {
    expect(eventSchema.safeParse(withField({ summary: 'x'.repeat(281) })).success).toBe(false);
    expect(eventSchema.safeParse(withField({ tenantId: '' })).success).toBe(false);
    expect(eventSchema.safeParse(withField({ runId: '' })).success).toBe(false);
    expect(eventSchema.safeParse(withField({ spanId: '' })).success).toBe(false);
  });

  it.each([
    ['source', 'webhook'],
    ['provenance', 'inferred'],
    ['actor', { type: 'robot', id: 'r' }],
    ['target', { system: 's', environment: 'prod' }],
    ['target', { system: 's', risk: 'severe' }],
  ])('rejects out-of-enum %s', (field, value) => {
    expect(eventSchema.safeParse(withField({ [field]: value })).success).toBe(false);
  });
});

describe('eventInputSchema', () => {
  const { seq: _seq, prevHash: _prev, hash: _hash, ...input } = validEvent;

  it('accepts an event without seq, prevHash and hash', () => {
    expect(eventInputSchema.parse(input)).toEqual(input);
  });

  it.each(['seq', 'prevHash', 'hash'])('rejects a supplied %s', (field) => {
    expect(
      eventInputSchema.safeParse({ ...input, [field]: validEvent[field as keyof Event] }).success,
    ).toBe(false);
  });

  it('still rejects unknown kinds and malformed timestamps', () => {
    expect(eventInputSchema.safeParse({ ...input, kind: 'nope' }).success).toBe(false);
    expect(eventInputSchema.safeParse({ ...input, ts: '2026-09-17T00:00:00' }).success).toBe(false);
  });
});
