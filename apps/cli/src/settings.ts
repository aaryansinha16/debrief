export const HOOK_EVENTS = ['Stop', 'SessionEnd'] as const;
export const HOOK_TIMEOUT_S = 10;

export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsError';
  }
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const quote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

export const hookCommand = (node: string, bin: string, configDir: string): string =>
  `${quote(node)} ${quote(bin)} claude-code hook --config ${quote(configDir)}`;

const isOurs = (handler: unknown): boolean =>
  isRecord(handler) &&
  typeof handler.command === 'string' &&
  handler.command.includes('debrief') &&
  handler.command.includes(' claude-code hook');

function hooksOf(settings: Json): Json {
  const hooks = settings.hooks ?? {};
  if (!isRecord(hooks)) throw new SettingsError('settings.hooks is not an object');
  for (const event of HOOK_EVENTS) {
    if (hooks[event] !== undefined && !Array.isArray(hooks[event])) {
      throw new SettingsError(`settings.hooks.${event} is not an array`);
    }
  }
  return hooks;
}

function stripped(groups: readonly unknown[]): unknown[] {
  return groups.flatMap((group) => {
    if (!isRecord(group) || !Array.isArray(group.hooks)) return [group];
    const handlers = group.hooks as unknown[];
    const kept = handlers.filter((handler) => !isOurs(handler));
    if (kept.length === handlers.length) return [group];
    return kept.length === 0 ? [] : [{ ...group, hooks: kept }];
  });
}

const ours: readonly string[] = HOOK_EVENTS;

export function withoutHook(settings: Json): Json {
  if (settings.hooks === undefined) return settings;
  const before = hooksOf(settings);
  const hooks = Object.fromEntries(
    Object.entries(before).flatMap(([event, groups]) => {
      if (!ours.includes(event)) return [[event, groups]];
      const kept = stripped(groups as unknown[]);
      return kept.length === 0 ? [] : [[event, kept]];
    }),
  );
  const { hooks: _hooks, ...rest } = settings;
  const emptied = Object.keys(hooks).length === 0 && Object.keys(before).length > 0;
  return emptied ? rest : { ...rest, hooks };
}

// Stop has no matcher (Claude Code hooks reference); one handler per event, however often install runs.
export function withHook(settings: Json, command: string): Json {
  const base = withoutHook(settings);
  const hooks = { ...hooksOf(base) };
  for (const event of HOOK_EVENTS) {
    const handler = { type: 'command', command, timeout: HOOK_TIMEOUT_S };
    const groups = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    hooks[event] = [...groups, { hooks: [handler] }];
  }
  return { ...base, hooks };
}
