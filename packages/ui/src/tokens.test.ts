import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { COLORS, FONTS, RISK_COLORS, SHADES, TYPE, mixHex, opaque } from './tokens.js';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const flat = css.toLowerCase().replace(/\s+/g, '');
const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const declares = (name: string, value: string): boolean =>
  flat.includes(`${name}:${value.toLowerCase().replace(/\s+/g, '').replaceAll('"', "'")};`);

const LEGACY = ['stage', 'stageRaised', 'stageEdge', 'ember', 'emberDim', 'cyan', 'cyanDim'];

describe('design tokens', () => {
  it('keeps tokens.css in step with the canvas tokens', () => {
    for (const [name, value] of Object.entries(COLORS)) {
      if (!LEGACY.includes(name))
        expect(declares(`--color-${kebab(name)}`, value), name).toBe(true);
    }
    expect(flat).toContain('--color-*:initial;');
    expect(declares('--font-sans', FONTS.sans)).toBe(true);
    expect(declares('--font-mono', FONTS.mono)).toBe(true);
  });

  it('derives opaque shades from canvas colours only', () => {
    expect(SHADES.line).toBe(mixHex('#FFFFFF', COLORS.ground, 0.08));
    expect(SHADES.lineStrong).toBe(mixHex('#FFFFFF', COLORS.ground, 0.22));
    expect(SHADES.holdsDim).toBe(mixHex(COLORS.holds, COLORS.ground, 0.35));
    expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(opaque(COLORS.text, COLORS.ground)).toBe(COLORS.text);
  });

  it('maps risk to the contradicted colour only from high upwards', () => {
    expect(RISK_COLORS.critical).toBe(COLORS.contradicted);
    expect(RISK_COLORS.high).toBe(COLORS.contradicted);
    expect(RISK_COLORS.medium).not.toBe(COLORS.contradicted);
    expect(RISK_COLORS.low).not.toBe(COLORS.contradicted);
  });

  it('names every text role once, each with a size and a colour', () => {
    expect(Object.keys(TYPE)).toEqual(['display', 'title', 'body', 'meta', 'label', 'mono', 'id']);
    for (const classes of Object.values(TYPE)) {
      expect(classes).toMatch(/text-(\[\d+px\]|xs|sm|base|2xl)/);
      expect(classes).toMatch(/text-text/);
    }
  });
});
