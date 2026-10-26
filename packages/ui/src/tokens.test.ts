import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  COLORS,
  FOIL,
  FONTS,
  FONT_FAMILIES,
  GLOW,
  MOTION,
  RADIUS,
  RISK_COLORS,
  SHADES,
  SPACE,
  TYPE,
  TYPE_SCALE,
  mixHex,
  objectGlow,
  opaque,
} from './tokens.js';

interface CanvasTokens {
  color: Record<string, string | string[]>;
  font: Record<string, string>;
  type: Record<string, { family: string; size: number; lineHeight?: number; tracking?: string }>;
  radius: Record<string, number>;
  space: Record<string, number>;
  glow: Record<string, string>;
  motion: Record<string, string>;
}

const canvas = JSON.parse(
  readFileSync(new URL('../../../docs/design/tokens.json', import.meta.url), 'utf8'),
) as CanvasTokens;
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const flat = css.toLowerCase().replace(/\s+/g, '');
const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const declares = (name: string, value: string): boolean =>
  flat.includes(`${name}:${value.toLowerCase().replace(/\s+/g, '').replaceAll('"', "'")};`);

const rgb = (color: string): [number, number, number] => {
  const solid = opaque(color, COLORS.ground);
  return [1, 3, 5].map((at) => Number.parseInt(solid.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ];
};
const luminance = (color: string): number => {
  const [r, g, b] = rgb(color).map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
// WCAG 2.2 §1.4.3 contrast ratio.
const contrast = (fg: string, bg: string): number => {
  const [light, dark] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
  return (light + 0.05) / (dark + 0.05);
};

describe('design tokens', () => {
  it('pins every colour to the canvas, the foil included', () => {
    const { foil, ...colors } = canvas.color;
    expect(COLORS).toEqual(colors);
    expect([...FOIL]).toEqual(foil);
  });

  it('pins fonts, type scale, radii, space, glow and motion to the canvas', () => {
    expect(FONT_FAMILIES).toEqual(canvas.font);
    expect(FONTS.display.startsWith(`'${FONT_FAMILIES.display}',`)).toBe(true);
    expect(FONTS.sans.startsWith(`${FONT_FAMILIES.ui},`)).toBe(true);
    expect(FONTS.mono.startsWith(`'${FONT_FAMILIES.mono}',`)).toBe(true);
    expect(TYPE_SCALE).toEqual(canvas.type);
    expect(RADIUS).toEqual(canvas.radius);
    expect(SPACE).toEqual(canvas.space);
    expect(GLOW).toEqual(canvas.glow);
    expect(MOTION).toEqual(canvas.motion);
  });

  it('keeps tokens.css in step with the canvas tokens', () => {
    for (const [name, value] of Object.entries(COLORS)) {
      expect(declares(`--color-${kebab(name)}`, value), name).toBe(true);
    }
    expect(css.match(/--color-[a-z-]+:/g)).toHaveLength(Object.keys(COLORS).length);
    expect(flat).toContain('--color-*:initial;');
    expect(declares('--font-display', FONTS.display)).toBe(true);
    expect(declares('--font-sans', FONTS.sans)).toBe(true);
    expect(declares('--font-mono', FONTS.mono)).toBe(true);
    for (const [name, value] of Object.entries(RADIUS)) {
      expect(declares(`--radius-${kebab(name)}`, `${String(value)}px`), name).toBe(true);
    }
    expect(declares('--container-page', `${String(SPACE.maxWidth)}px`)).toBe(true);
    expect(declares('--spacing-page', `${String(SPACE.pagePadX)}px`)).toBe(true);
    expect(declares('--spacing-dot', `${String(SPACE.gridDot)}px`)).toBe(true);
    expect(declares('--shadow-cta', GLOW.cta)).toBe(true);
    expect(declares('--shadow-panel', GLOW.panel)).toBe(true);
    expect(declares('--shadow-glow-holds', objectGlow('var(--color-holds)'))).toBe(true);
    expect(declares('--shadow-glow-contradicted', objectGlow('var(--color-contradicted)'))).toBe(
      true,
    );
  });

  it('reads every text colour at 4.5:1 or better on the ground, the surfaces and a contradicted row', () => {
    const tint = mixHex(COLORS.contradicted, COLORS.ground, 0.09);
    const grounds = [COLORS.ground, COLORS.surfaceRaised, COLORS.surface, SHADES.line, tint];
    const inks = [
      COLORS.text,
      COLORS.textMuted,
      COLORS.textSubtle,
      COLORS.label,
      COLORS.holds,
      COLORS.contradicted,
      COLORS.noWitness,
    ];
    for (const ink of inks) {
      for (const ground of grounds)
        expect(contrast(ink, ground), `${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(COLORS.paperInk, COLORS.paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(COLORS.ground, COLORS.text)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(COLORS.ground, COLORS.contradicted)).toBeGreaterThanOrEqual(4.5);
  });

  it('derives opaque shades from canvas colours only', () => {
    expect(SHADES.line).toBe(mixHex('#FFFFFF', COLORS.ground, 0.08));
    expect(SHADES.lineStrong).toBe(mixHex('#FFFFFF', COLORS.ground, 0.22));
    expect(SHADES.holdsDim).toBe(mixHex(COLORS.holds, COLORS.ground, 0.35));
    expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(opaque(COLORS.text, COLORS.ground)).toBe(COLORS.text);
    expect(objectGlow(COLORS.holds)).toBe(`0 0 14px ${COLORS.holds}`);
  });

  it('maps risk to the contradicted colour only from high upwards', () => {
    expect(RISK_COLORS.critical).toBe(COLORS.contradicted);
    expect(RISK_COLORS.high).toBe(COLORS.contradicted);
    expect(RISK_COLORS.medium).not.toBe(COLORS.contradicted);
    expect(RISK_COLORS.low).not.toBe(COLORS.contradicted);
  });

  it('sets the canvas text roles in their face, size and tracking', () => {
    const family = { display: 'font-display', ui: 'font-sans', mono: 'font-mono' } as const;
    for (const [role, spec] of Object.entries(TYPE_SCALE)) {
      const classes = TYPE[role as keyof typeof TYPE_SCALE];
      expect(classes, role).toContain(family[spec.family]);
      expect(classes, role).toContain(`text-[${String(spec.size)}px]`);
      if ('lineHeight' in spec)
        expect(classes, role).toContain(`leading-[${String(spec.lineHeight)}]`);
      if ('tracking' in spec) expect(classes, role).toContain(`tracking-[${spec.tracking}]`);
      if ('case' in spec) expect(classes, role).toContain('uppercase');
    }
    for (const classes of Object.values(TYPE)) {
      expect(classes).toMatch(/font-(display|sans|mono)/);
      expect(classes).toMatch(/text-(text|label)/);
    }
  });
});
