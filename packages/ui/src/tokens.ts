// ARCHITECTURE §11 design language: near-black stage, ember for risk, cyan for authority, off-white text, mono for ids.
export const COLORS = {
  stage: '#0b0b0f',
  stageRaised: '#14141b',
  stageEdge: '#23232e',
  text: '#f2efe8',
  textMuted: '#9c9aa3',
  ember: '#ff7a3d',
  emberDim: '#8a3a1a',
  cyan: '#4fd6ff',
  cyanDim: '#1f5a6e',
} as const;

export const FONTS = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
} as const;

export const RISK_COLORS = {
  low: COLORS.textMuted,
  medium: COLORS.cyan,
  high: COLORS.ember,
  critical: COLORS.ember,
} as const;

export const PROVENANCE_LABELS = {
  reported: 'reported',
  observed: 'observed',
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
