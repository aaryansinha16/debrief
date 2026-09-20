import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { COLORS, FONTS, RISK_COLORS, TYPE } from './tokens.js';

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

  it('names every text role once, each with a size and a colour', () => {
    expect(Object.keys(TYPE)).toEqual(['display', 'title', 'body', 'meta', 'label', 'mono', 'id']);
    for (const classes of Object.values(TYPE)) {
      expect(classes).toMatch(/text-(\[\d+px\]|xs|sm|base|2xl)/);
      expect(classes).toMatch(/text-text/);
    }
  });
});
