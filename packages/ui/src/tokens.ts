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

export const FONT_FAMILIES = {
  display: 'Instrument Serif',
  ui: 'Geist',
  mono: 'Geist Mono',
} as const;

export const FONTS = {
  display: "'Instrument Serif', ui-serif, Georgia, 'Times New Roman', serif",
  sans: "Geist, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "'Geist Mono', ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
} as const;

export const TYPE_SCALE = {
  hero: { family: 'display', size: 92, lineHeight: 0.95, tracking: '-0.02em' },
  h1: { family: 'display', size: 72, lineHeight: 0.98 },
  claim: { family: 'display', size: 27, lineHeight: 1.15 },
  body: { family: 'ui', size: 15, lineHeight: 1.5 },
  lead: { family: 'ui', size: 18, lineHeight: 1.5 },
  label: { family: 'mono', size: 11, tracking: '0.1em', case: 'upper' },
  meta: { family: 'mono', size: 12 },
} as const;

export const RADIUS = { pill: 999, card: 20, panel: 28, stage: 32, phoneCard: 30 } as const;

export const SPACE = { pagePadX: 32, maxWidth: 1320, gridDot: 26 } as const;

export const GLOW = {
  object: '0 0 14px <state color>',
  cta: '0 10px 40px rgba(245,243,238,0.18)',
  panel: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 40px 80px rgba(0,0,0,0.5)',
} as const;

export const objectGlow = (color: string): string => GLOW.object.replace('<state color>', color);

export const MOTION = {
  ui: '150-250ms spring',
  beamPulse: '2.4s linear infinite, staggered 0.6s per row',
  fracture: '2.2s stepped flicker',
  ghostScan: '3.6s linear infinite',
  railFlow: '1.4s dash offset',
  sealSpin: '9s foil, 24s text ring reverse',
  verifyStagger: 'checks 0.35s apart, chain links 45ms apart',
  reducedMotion: 'all off',
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

// Tailwind classes per text role: the canvas roles of TYPE_SCALE plus the app's page title, row title and ids.
export const TYPE = {
  hero: 'font-display text-[92px] leading-[0.95] tracking-[-0.02em] font-normal text-text',
  h1: 'font-display text-[72px] leading-[0.98] font-normal text-text',
  display: 'font-display text-[44px] leading-none font-normal text-text',
  claim: 'font-display text-[27px] leading-[1.15] font-normal text-text',
  title: 'font-sans text-[17px] leading-snug font-semibold text-text',
  lead: 'font-sans text-[18px] leading-[1.5] text-text-muted',
  body: 'font-sans text-[15px] leading-[1.5] text-text',
  label: 'font-mono text-[11px] tracking-[0.1em] uppercase text-label',
  meta: 'font-mono text-[12px] text-label',
  mono: 'font-mono text-[12px] text-text-muted',
  id: 'font-mono text-sm text-text',
} as const;

export type TypeRole = keyof typeof TYPE;
