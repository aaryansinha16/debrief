import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { COLORS, FONTS, RISK_COLORS } from './tokens.js';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe('design tokens', () => {
  it('keeps tokens.css in sync with tokens.ts', () => {
    for (const [name, value] of Object.entries(COLORS)) {
      expect(css, name).toContain(`--color-${kebab(name)}: ${value};`);
    }
    for (const [name, value] of Object.entries(FONTS)) {
      expect(css, name).toContain(`--font-${name}: ${value.replaceAll('"', "'")};`);
    }
    expect(css.match(/--color-/g)).toHaveLength(Object.keys(COLORS).length);
  });

  it('maps risk to the ember accent only from high upwards', () => {
    expect(RISK_COLORS.critical).toBe(COLORS.ember);
    expect(RISK_COLORS.high).toBe(COLORS.ember);
    expect(RISK_COLORS.medium).not.toBe(COLORS.ember);
    expect(RISK_COLORS.low).not.toBe(COLORS.ember);
  });
});
