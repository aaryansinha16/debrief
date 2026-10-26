import { describe, expect, it } from 'vitest';

import { claudeSettingsFile, debriefConfigDir } from './paths.js';

describe('paths', () => {
  it('puts the debrief config under DEBRIEF_CONFIG_DIR, then XDG_CONFIG_HOME, then ~/.config', () => {
    expect(debriefConfigDir({ DEBRIEF_CONFIG_DIR: '/c' }, '/h')).toBe('/c');
    expect(debriefConfigDir({ XDG_CONFIG_HOME: '/x' }, '/h')).toBe('/x/debrief');
    expect(debriefConfigDir({ DEBRIEF_CONFIG_DIR: '', XDG_CONFIG_HOME: '' }, '/h')).toBe(
      '/h/.config/debrief',
    );
  });

  it('finds the Claude Code user settings under CLAUDE_CONFIG_DIR or ~/.claude', () => {
    expect(claudeSettingsFile({ CLAUDE_CONFIG_DIR: '/cc' }, '/h')).toBe('/cc/settings.json');
    expect(claudeSettingsFile({}, '/h')).toBe('/h/.claude/settings.json');
  });
});
