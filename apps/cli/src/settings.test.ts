import { describe, expect, it } from 'vitest';

import { HOOK_TIMEOUT_S, SettingsError, hookCommand, withHook, withoutHook } from './settings.js';

const COMMAND = hookCommand(
  '/usr/bin/node',
  '/opt/debrief/bin/debrief.js',
  '/home/u/.config/debrief',
);
const ours = { type: 'command', command: COMMAND, timeout: HOOK_TIMEOUT_S };
const theirs = { type: 'command', command: 'say done' };

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
  });

  it('refuses settings it cannot read safely', () => {
    expect(() => withHook({ hooks: [] }, COMMAND)).toThrow(SettingsError);
    expect(() => withHook({ hooks: { Stop: {} } }, COMMAND)).toThrow(/hooks.Stop is not an array/);
  });
});
