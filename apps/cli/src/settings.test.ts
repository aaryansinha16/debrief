import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  HOOK_TIMEOUT_S,
  SettingsError,
  hookCommand,
  installHook,
  uninstallHook,
  withHook,
  withoutHook,
} from './settings.js';

const COMMAND = hookCommand(
  '/usr/bin/node',
  '/opt/debrief/bin/debrief.js',
  '/home/u/.config/debrief',
);
const ours = { type: 'command', command: COMMAND, timeout: HOOK_TIMEOUT_S };
const theirs = { type: 'command', command: 'say done' };

function dirs() {
  const root = mkdtempSync(join(tmpdir(), 'debrief-settings-'));
  return {
    claude: join(root, '.claude'),
    file: join(root, '.claude', 'settings.json'),
    config: join(root, 'debrief'),
  };
}

describe('withHook and withoutHook', () => {
  it('adds one handler per event however often it runs, next to the user’s own hooks', () => {
    const settings = {
      model: 'opus',
      hooks: { Stop: [{ hooks: [theirs] }], PreToolUse: [{ matcher: 'Bash', hooks: [theirs] }] },
    };
    const once = withHook(settings, COMMAND);
    expect(withHook(once, COMMAND)).toEqual(once);
    expect(once).toEqual({
      model: 'opus',
      hooks: {
        Stop: [{ hooks: [theirs] }, { hooks: [ours] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [theirs] }],
        SessionEnd: [{ hooks: [ours] }],
      },
    });
    expect(withoutHook(once)).toEqual(settings);
    expect(hookCommand('/a b/node', "/it's/debrief.js", '/c')).toBe(
      `'/a b/node' '/it'\\''s/debrief.js' claude-code hook --config '/c'`,
    );
  });

  it('removes only its handlers, keeping mixed groups and odd entries, and drops what it emptied', () => {
    const mixed = withoutHook({ hooks: { Stop: [{ hooks: [theirs, ours] }, 'odd', { x: 1 }] } });
    expect(mixed).toEqual({ hooks: { Stop: [{ hooks: [theirs] }, 'odd', { x: 1 }] } });
    expect(withoutHook({ a: 1, hooks: { Stop: [{ hooks: [ours] }] } })).toEqual({ a: 1 });
    expect(withoutHook({ hooks: {} })).toEqual({ hooks: {} });
    expect(withoutHook({ a: 1 })).toEqual({ a: 1 });
    const lookalike = {
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: '/u/debrief-mirror/notify.sh --on claude-code hook' },
            ],
          },
        ],
      },
    };
    expect(withoutHook(lookalike)).toBe(lookalike);
  });

  it('returns settings without its handler untouched and keeps the user’s key order', () => {
    const empty = { hooks: { Stop: [], PostToolUse: [{ hooks: [theirs] }] } };
    expect(withoutHook(empty)).toBe(empty);
    const foreign = { model: 'opus', hooks: { PostToolUse: [{ hooks: [theirs] }] }, theme: 'dark' };
    const installed = withHook(foreign, COMMAND);
    expect(Object.keys(installed)).toEqual(['model', 'hooks', 'theme']);
    expect(Object.keys(withoutHook(installed))).toEqual(['model', 'hooks', 'theme']);
    expect(withoutHook(installed)).toEqual(foreign);
    expect(Object.keys(withHook({ a: 1 }, COMMAND))).toEqual(['a', 'hooks']);
  });

  it('refuses settings it cannot read safely', () => {
    expect(() => withHook({ hooks: [] }, COMMAND)).toThrow(SettingsError);
    expect(() => withHook({ hooks: { Stop: {} } }, COMMAND)).toThrow(/hooks.Stop is not an array/);
  });
});

describe('installHook and uninstallHook', () => {
  it('creates user settings when there were none and removes them again', () => {
    const { claude, file, config } = dirs();
    installHook(file, config, COMMAND);
    installHook(file, config, COMMAND);
    const written = readFileSync(file, 'utf8');
    expect(JSON.parse(written)).toEqual({
      hooks: { Stop: [{ hooks: [ours] }], SessionEnd: [{ hooks: [ours] }] },
    });
    expect(written).not.toContain('dbf_');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(claude)).toEqual(['settings.json']);
    expect(uninstallHook(file, config)).toBe('restored');
    expect(existsSync(file)).toBe(false);
    expect(uninstallHook(file, config)).toBe('absent');
  });

  it('restores the original bytes and mode when nothing else changed the file', () => {
    const { file, config } = dirs();
    installHook(file, config, COMMAND);
    uninstallHook(file, config);
    const original =
      '{\n    "model": "opus",\n    "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "say done" } ] } ] }\n}';
    writeFileSync(file, original);
    chmodSync(file, 0o644);
    installHook(file, config, COMMAND);
    installHook(file, config, COMMAND);
    expect(statSync(file).mode & 0o777).toBe(0o644);
    expect(uninstallHook(file, config)).toBe('restored');
    expect(readFileSync(file, 'utf8')).toBe(original);
  });

  it('keeps the user’s later edits and removes only its handlers', () => {
    const { file, config } = dirs();
    installHook(file, config, COMMAND);
    const edited = { ...JSON.parse(readFileSync(file, 'utf8')), theme: 'dark' } as Record<
      string,
      unknown
    >;
    writeFileSync(file, JSON.stringify(edited));
    expect(uninstallHook(file, config)).toBe('removed');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ theme: 'dark' });
    writeFileSync(file, '{"theme":"dark"}');
    expect(uninstallHook(file, config)).toBe('absent');
  });

  it('never rewrites settings that hold no debrief hook, even when never installed', () => {
    const { file, config } = dirs();
    installHook(file, config, COMMAND);
    uninstallHook(file, config);
    const original =
      '{\n  "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "say done" } ] } ] },\n  "theme": "dark"\n}';
    writeFileSync(file, original);
    expect(uninstallHook(file, config)).toBe('absent');
    expect(readFileSync(file, 'utf8')).toBe(original);
  });

  it('drops a stale backup when the file changed between installs, so uninstall keeps others’ hooks', () => {
    const { file, config } = dirs();
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, '{"model":"opus"}');
    installHook(file, config, COMMAND);
    const edited = JSON.parse(readFileSync(file, 'utf8')) as { hooks: Record<string, unknown> };
    edited.hooks.PreToolUse = [{ matcher: 'Bash', hooks: [theirs] }];
    writeFileSync(file, JSON.stringify(edited));
    installHook(file, config, COMMAND);
    expect(uninstallHook(file, config)).toBe('removed');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      model: 'opus',
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [theirs] }] },
    });
  });

  it('keeps a symlinked settings file a link and leaves the Claude directory’s mode alone', () => {
    const { claude, file, config } = dirs();
    mkdirSync(claude, { mode: 0o755 });
    chmodSync(claude, 0o755);
    const real = join(claude, 'dotfiles-settings.json');
    writeFileSync(real, '{"theme":"dark"}');
    symlinkSync(real, file);
    installHook(file, config, COMMAND);
    expect(lstatSync(file).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf8')).toContain('claude-code hook');
    expect(statSync(claude).mode & 0o777).toBe(0o755);
    expect(uninstallHook(file, config)).toBe('restored');
    expect(lstatSync(file).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf8')).toBe('{"theme":"dark"}');
  });

  it('keeps the backup when uninstall cannot finish and ignores a corrupt one', () => {
    const { file, config } = dirs();
    installHook(file, config, COMMAND);
    const backup = join(config, 'claude-settings.backup.json');
    writeFileSync(file, '{ broken');
    expect(() => uninstallHook(file, config)).toThrow(SettingsError);
    expect(existsSync(backup)).toBe(true);
    installHook(file.replace('settings.json', 'other.json'), config, COMMAND);
    writeFileSync(backup, 'not json');
    writeFileSync(file, JSON.stringify(withHook({ a: 1 }, COMMAND)));
    expect(uninstallHook(file, config)).toBe('removed');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 1 });
  });

  it('leaves invalid settings untouched', () => {
    const { file, config } = dirs();
    installHook(file, config, COMMAND);
    uninstallHook(file, config);
    for (const text of ['{ not json', '[1]']) {
      writeFileSync(file, text);
      expect(() => {
        installHook(file, config, COMMAND);
      }).toThrow(SettingsError);
      expect(readFileSync(file, 'utf8')).toBe(text);
    }
  });
});
