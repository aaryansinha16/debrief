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
