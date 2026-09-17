import { describe, expect, it } from 'vitest';

import { formatTraceparent, parseTraceparent, randomSpanId, randomTraceId } from './traceparent.js';

describe('traceparent', () => {
  it('parses valid headers and rejects invalid ones', () => {
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toEqual({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      sampled: true,
    });
    expect(
      parseTraceparent(' 00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-00 ')!.sampled,
    ).toBe(false);
    for (const bad of [
      undefined,
      42,
      '',
      'garbage',
      '01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      `00-${'0'.repeat(32)}-00f067aa0ba902b7-01`,
      `00-4bf92f3577b34da6a3ce929d0e0e4736-${'0'.repeat(16)}-01`,
    ]) {
      expect(parseTraceparent(bad)).toBeUndefined();
    }
  });

  it('formats and generates ids', () => {
    expect(formatTraceparent('a'.repeat(32), 'b'.repeat(16))).toBe(
      `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
    );
    expect(formatTraceparent('a'.repeat(32), 'b'.repeat(16), false)).toMatch(/-00$/);
    expect(randomTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(randomSpanId()).toMatch(/^[0-9a-f]{16}$/);
    expect(randomTraceId()).not.toBe(randomTraceId());
  });
});
