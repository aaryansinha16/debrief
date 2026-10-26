import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertOutsideHome,
  guardModule,
  guardedDirs,
  guardedPath,
  tempHomeEnv,
} from './home-guard.js';
import { claudeSettingsFile, debriefConfigDir } from './paths.js';

describe('the home guard', () => {
  const guarded = guardedDirs({}, '/Users/someone');

  it('names the two config dirs and recognises paths under them', () => {
    expect(guarded.map((g) => g.dir)).toEqual([
      '/Users/someone/.claude',
      '/Users/someone/.config/debrief',
    ]);
    expect(guardedPath('/Users/someone/.claude/settings.json', guarded)?.label).toBe(
      'Claude Code settings',
    );
    expect(guardedPath('/Users/someone/.config/debrief', guarded)?.label).toBe('Debrief config');
    expect(guardedPath('/Users/someone/.claude-other/x', guarded)).toBeUndefined();
    expect(guardedPath('relative/.claude/settings.json', guarded)).toBeUndefined();
    expect(guardedPath(3, guarded)).toBeUndefined();
    expect(guardedDirs({ CLAUDE_CONFIG_DIR: '/cc', DEBRIEF_CONFIG_DIR: '/dd' }, '/h')[0]?.dir).toBe(
      '/cc',
    );
  });

  it('throws on a guarded path in any argument position and passes everything else', () => {
    expect(() => { assertOutsideHome('renameSync', ['/tmp/a', '/Users/someone/.claude/b'], guarded); },
    ).toThrow(
      /fs\.renameSync touched the real Claude Code settings at \/Users\/someone\/\.claude\/b/,
    );
    expect(() => { assertOutsideHome('readSync', [3, Buffer.alloc(1), 'utf8'], guarded); },
    ).not.toThrow();
    const fs = guardModule(
      {
        readFileSync: (path: unknown) => path,
        constants: { O_RDONLY: 0 },
        promises: { readFile: (path: unknown) => Promise.resolve(path) },
      },
      guarded,
    );
    expect(fs.readFileSync('/tmp/x')).toBe('/tmp/x');
    expect(() => fs.readFileSync('/Users/someone/.config/debrief/config.json')).toThrow(
      /Debrief config/,
    );
    expect(() => fs.promises.readFile('/Users/someone/.claude/settings.json')).toThrow(
      /Claude Code/,
    );
    expect(fs.constants).toEqual({ O_RDONLY: 0 });
  });

  it('is installed for this suite: defaults resolve under a temp home and the real dirs throw', () => {
    const home = homedir();
    expect(home).toMatch(/debrief-home-/);
    expect(claudeSettingsFile()).toBe(join(home, '.claude', 'settings.json'));
    expect(debriefConfigDir()).toBe(join(home, '.config', 'debrief'));
    expect(tempHomeEnv('/t')).toEqual({
      HOME: '/t',
      CLAUDE_CONFIG_DIR: '/t/.claude',
      DEBRIEF_CONFIG_DIR: '/t/.config/debrief',
      XDG_CONFIG_HOME: '/t/.config',
    });
    const realHome = process.env.DEBRIEF_REAL_HOME;
    expect(realHome).toBeTruthy();
    expect(realHome).not.toBe(home);
    for (const { dir } of guardedDirs({}, realHome ?? '')) {
      expect(() => existsSync(join(dir, 'settings.json'))).toThrow(/touched the real/);
      expect(() => readFileSync(join(dir, 'config.json'), 'utf8')).toThrow(/touched the real/);
    }
  });
});
