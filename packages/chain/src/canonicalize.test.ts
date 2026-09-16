import { describe, expect, it } from 'vitest';

import { canonicalize } from './canonicalize.js';
import { CanonicalizeError } from './errors.js';

describe('canonicalize', () => {
  it('matches the RFC 8785 section 3.2.3 property sorting example', () => {
    const input: unknown = JSON.parse(String.raw`{
      "\u20ac": "Euro Sign",
      "\r": "Carriage Return",
      "\ufb33": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "\ud83d\ude00": "Emoji: Grinning Face",
      "\u0080": "Control",
      "\u00f6": "Latin Small Letter O With Diaeresis"
    }`);
    expect(canonicalize(input)).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","\u00f6":"Latin Small Letter O With Diaeresis","\u20ac":"Euro Sign","\ud83d\ude00":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}',
    );
  });

  it('matches the RFC 8785 section 3.2.4 literals, numbers and string example', () => {
    const input: unknown = JSON.parse(String.raw`{
      "numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],
      "string": "\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"\u002f",
      "literals": [null, true, false]
    }`);
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"\u20ac$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('serializes numbers with the shortest round-trip form', () => {
    expect(
      canonicalize([
        0,
        -0,
        1e21,
        1e-7,
        123456789012345680000,
        0.1 + 0.2,
        5e-324,
        1.7976931348623157e308,
      ]),
    ).toBe(
      '[0,0,1e+21,1e-7,123456789012345680000,0.30000000000000004,5e-324,1.7976931348623157e+308]',
    );
  });

  it('escapes control characters and lone surrogates, leaves other unicode raw', () => {
    expect(canonicalize('\u0000\u001f"\\/\ud800\u00e9')).toBe(
      '"\\u0000\\u001f\\"\\\\/\\ud800\u00e9"',
    );
  });

  it('is independent of insertion order and sorts keys as strings', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(canonicalize({ 9: 'nine', 10: 'ten', a: { z: 1, y: [true, null] } })).toBe(
      '{"10":"ten","9":"nine","a":{"y":[true,null],"z":1}}',
    );
  });

  it('omits undefined properties and accepts null-prototype objects', () => {
    expect(canonicalize({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalize({})).toBe('{}');
    expect(canonicalize([])).toBe('[]');
    const bare: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    bare.k = 'v';
    expect(canonicalize(bare)).toBe('{"k":"v"}');
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['bigint', 10n],
    ['function', () => 1],
    ['symbol', Symbol('s')],
    ['undefined', undefined],
    ['undefined element', [1, undefined]],
    ['Date', new Date(0)],
    ['Map', new Map()],
    [
      'class instance',
      new (class Foo {
        value = 1;
      })(),
    ],
    ['nested NaN', { a: { b: Number.NaN } }],
  ])('rejects %s', (_label, value) => {
    expect(() => canonicalize(value)).toThrow(CanonicalizeError);
  });

  it('is idempotent', () => {
    const value = { z: [1, 'two', { c: null, b: false }], a: { nested: { deep: 1e-7 } } };
    const once = canonicalize(value);
    expect(canonicalize(JSON.parse(once))).toBe(once);
    expect(JSON.parse(once)).toEqual(value);
  });
});
