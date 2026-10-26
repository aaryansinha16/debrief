import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import { ensurePrivateDir, writePrivateFile } from './config.js';

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

const holdsOurs = (groups: unknown): boolean =>
  Array.isArray(groups) &&
  groups.some((group) => isRecord(group) && Array.isArray(group.hooks) && group.hooks.some(isOurs));

// Rebuilt in the same key order, so a rewrite moves nothing the user arranged.
function replaceHooks(settings: Json, hooks: Json | undefined): Json {
  const entries = Object.entries(settings).flatMap(([key, value]) => {
    if (key !== 'hooks') return [[key, value]];
    return hooks === undefined ? [] : [[key, hooks]];
  });
  if (hooks !== undefined && !('hooks' in settings)) entries.push(['hooks', hooks]);
  return Object.fromEntries(entries) as Json;
}

// Settings without a Debrief handler come back as the same object, so uninstall never rewrites them.
export function withoutHook(settings: Json): Json {
  if (settings.hooks === undefined) return settings;
  const before = hooksOf(settings);
  if (!ours.some((event) => holdsOurs(before[event]))) return settings;
  const hooks = Object.fromEntries(
    Object.entries(before).flatMap(([event, groups]) => {
      if (!ours.includes(event) || !holdsOurs(groups)) return [[event, groups]];
      const kept = stripped(groups as unknown[]);
      return kept.length === 0 ? [] : [[event, kept]];
    }),
  );
  return replaceHooks(settings, Object.keys(hooks).length === 0 ? undefined : hooks);
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
  return replaceHooks(base, hooks);
}

const backupSchema = z.strictObject({
  original: z.string().nullable(),
  written: z.string(),
});

const backupFile = (configDir: string): string => join(configDir, 'claude-settings.backup.json');
const digest = (text: string): string => createHash('sha256').update(text).digest('hex');

function parse(text: string | null): Json {
  if (text === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SettingsError('Claude Code settings are not valid JSON; fix them first');
  }
  if (!isRecord(value)) throw new SettingsError('Claude Code settings are not a JSON object');
  return value;
}

const read = (file: string): string | null =>
  existsSync(file) ? readFileSync(file, 'utf8') : null;

function write(file: string, text: string): void {
  const mode = existsSync(file) ? statSync(file).mode & 0o777 : 0o600;
  const temp = `${file}.${String(process.pid)}.tmp`;
  writeFileSync(temp, text, { mode });
  renameSync(temp, file);
}

export function installHook(settingsFile: string, configDir: string, command: string): void {
  const current = read(settingsFile);
  const text = `${JSON.stringify(withHook(parse(current), command), null, 2)}\n`;
  const previous = backupSchema.safeParse(parse(read(backupFile(configDir))));
  const original = previous.success ? previous.data.original : current;
  ensurePrivateDir(configDir);
  writePrivateFile(backupFile(configDir), JSON.stringify({ original, written: digest(text) }));
  ensurePrivateDir(dirname(settingsFile));
  write(settingsFile, text);
}

export type UninstallOutcome = 'restored' | 'removed' | 'absent';

// Byte-for-byte restore when nothing else changed the file since install; otherwise remove only our handlers.
export function uninstallHook(settingsFile: string, configDir: string): UninstallOutcome {
  const current = read(settingsFile);
  const backup = backupSchema.safeParse(parse(read(backupFile(configDir))));
  rmSync(backupFile(configDir), { force: true });
  if (backup.success && current !== null && digest(current) === backup.data.written) {
    if (backup.data.original === null) rmSync(settingsFile);
    else write(settingsFile, backup.data.original);
    return 'restored';
  }
  if (current === null) return 'absent';
  const parsed = parse(current);
  const next = withoutHook(parsed);
  if (next === parsed) return 'absent';
  write(settingsFile, `${JSON.stringify(next, null, 2)}\n`);
  return 'removed';
}
