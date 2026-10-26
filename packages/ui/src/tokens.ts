// The Witness canvas, docs/design/tokens.json (D-080): tokens.test.ts pins every value below to that file.
const CANVAS_COLORS = {
  ground: '#06070A',
  surface: 'rgba(255,255,255,0.035)',
  surfaceRaised: '#0C0E14',
  line: 'rgba(255,255,255,0.08)',
  lineStrong: 'rgba(255,255,255,0.22)',
  text: '#F5F3EE',
  textMuted: '#B9BDC6',
  textSubtle: '#9EA3AE',
  label: '#8A90A0',
  holds: '#7CA6FF',
  contradicted: '#FF6A3D',
  noWitness: '#8A90A0',
  paper: '#FBFAF5',
  paperInk: '#17171B',
} as const;

export const FOIL = ['#FFB38A', '#FFE7A3', '#9FF5D6', '#7CA6FF', '#D3B6FF', '#FF9EC4'] as const;

const channels = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

const toHex = (rgb: readonly number[]): string =>
  `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

export function mixHex(color: string, base: string, amount: number): string {
  const [ar, ag, ab] = channels(color);
  const [br, bg, bb] = channels(base);
  const blend = (top: number, bottom: number): number => top * amount + bottom * (1 - amount);
  return toHex([blend(ar, br), blend(ag, bg), blend(ab, bb)]);
}

export function opaque(rgba: string, base: string): string {
  const parts = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(rgba.replaceAll(' ', ''));
  if (parts === null) return rgba;
  const [r, g, b, alpha] = parts.slice(1).map(Number) as [number, number, number, number];
  return mixHex(toHex([r, g, b]), base, alpha);
}

// WebGL and canvas fills have no page beneath them: the translucent lines composited over the ground, and dimmed accents.
export const SHADES = {
  line: opaque(CANVAS_COLORS.line, CANVAS_COLORS.ground),
  lineStrong: opaque(CANVAS_COLORS.lineStrong, CANVAS_COLORS.ground),
  holdsDim: mixHex(CANVAS_COLORS.holds, CANVAS_COLORS.ground, 0.35),
  contradictedDim: mixHex(CANVAS_COLORS.contradicted, CANVAS_COLORS.ground, 0.45),
} as const;

export const COLORS = {
  ...CANVAS_COLORS,
  stage: CANVAS_COLORS.ground,
  stageRaised: CANVAS_COLORS.surfaceRaised,
  stageEdge: SHADES.line,
  ember: CANVAS_COLORS.contradicted,
  emberDim: SHADES.contradictedDim,
  cyan: CANVAS_COLORS.holds,
  cyanDim: SHADES.holdsDim,
} as const;

export const FONTS = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
} as const;

export const RISK_COLORS = {
  low: COLORS.textSubtle,
  medium: COLORS.text,
  high: COLORS.contradicted,
  critical: COLORS.contradicted,
} as const;

export const PROVENANCE_LABELS = {
  reported: 'reported',
  observed: 'observed',
  derived: 'derived',
} as const;

export type ColorToken = keyof typeof COLORS;

// The one type scale (ARCHITECTURE §11): six roles, Tailwind classes, used by every web component so no page invents a size.
export const TYPE = {
  display: 'text-2xl font-semibold tracking-tight text-text',
  title: 'text-base font-semibold text-text',
  body: 'text-sm text-text',
  meta: 'text-sm text-text-muted',
  label: 'text-[11px] font-medium tracking-[0.18em] uppercase text-text-muted',
  mono: 'font-mono text-xs text-text-muted',
  id: 'font-mono text-sm text-text',
} as const;

export type TypeRole = keyof typeof TYPE;
