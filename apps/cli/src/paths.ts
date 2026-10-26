import { homedir } from 'node:os';
import { join } from 'node:path';

const given = (value: string | undefined): string | undefined =>
  value === undefined || value === '' ? undefined : value;

export function debriefConfigDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const base = given(env.XDG_CONFIG_HOME) ?? join(home, '.config');
  return given(env.DEBRIEF_CONFIG_DIR) ?? join(base, 'debrief');
}

// Claude Code keeps user settings under $CLAUDE_CONFIG_DIR, default ~/.claude.
export function claudeSettingsFile(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(given(env.CLAUDE_CONFIG_DIR) ?? join(home, '.claude'), 'settings.json');
}
