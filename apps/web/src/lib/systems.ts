// Display names per target.system, the one place a system gets its label. The sample's systems are invented (D-079).
export const SYSTEM_LABELS = {
  'claude-code': 'Claude Code',
  forge: 'Forge',
  tidewater: 'Tidewater',
  skyport: 'Skyport',
  ledgerline: 'Ledgerline',
  git: 'Local git',
  secrets: 'Secrets manager',
} as const;

export type KnownSystem = keyof typeof SYSTEM_LABELS;

export const isKnownSystem = (system: string): system is KnownSystem =>
  Object.hasOwn(SYSTEM_LABELS, system);

export const systemLabel = (system: string): string =>
  isKnownSystem(system) ? SYSTEM_LABELS[system] : system;
