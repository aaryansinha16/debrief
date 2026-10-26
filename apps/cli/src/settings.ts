import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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

function readBackup(configDir: string): z.infer<typeof backupSchema> | undefined {
  try {
    const parsed = backupSchema.safeParse(JSON.parse(read(backupFile(configDir)) ?? 'null'));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// Written beside the resolved file, so a symlinked settings file (a dotfile manager's) stays a link.
function write(file: string, text: string): void {
  const target = existsSync(file) ? realpathSync(file) : file;
  const mode = existsSync(target) ? statSync(target).mode & 0o777 : 0o600;
  const temp = `${target}.${String(process.pid)}.tmp`;
  writeFileSync(temp, text, { mode });
  renameSync(temp, target);
}

export function installHook(settingsFile: string, configDir: string, command: string): void {
  const current = read(settingsFile);
  const parsed = parse(current);
  const text = `${JSON.stringify(withHook(parsed, command), null, 2)}\n`;
  const previous = readBackup(configDir);
  // The byte-exact original holds only while the file is still what the last install wrote.
  const unchanged =
    previous !== undefined && current !== null && digest(current) === previous.written;
  const fresh = withoutHook(parsed) === parsed;
  const original = unchanged ? previous.original : fresh ? current : undefined;
  if (read(settingsFile) !== current) {
    throw new SettingsError('Claude Code changed its settings during install; run it again');
  }
  ensurePrivateDir(configDir);
  if (original === undefined) rmSync(backupFile(configDir), { force: true });
  else writePrivateFile(backupFile(configDir), JSON.stringify({ original, written: digest(text) }));
  mkdirSync(dirname(settingsFile), { recursive: true });
  write(settingsFile, text);
}

export type UninstallOutcome = 'restored' | 'removed' | 'absent';

// Byte-for-byte restore when nothing else changed the file since install; otherwise remove only our handlers.
export function uninstallHook(settingsFile: string, configDir: string): UninstallOutcome {
  const current = read(settingsFile);
  const backup = readBackup(configDir);
  let outcome: UninstallOutcome = 'absent';
  if (backup !== undefined && current !== null && digest(current) === backup.written) {
    if (backup.original === null) rmSync(settingsFile);
    else write(settingsFile, backup.original);
    outcome = 'restored';
  } else if (current !== null) {
    const parsed = parse(current);
    const next = withoutHook(parsed);
    if (next !== parsed) {
      write(settingsFile, `${JSON.stringify(next, null, 2)}\n`);
      outcome = 'removed';
    }
  }
  rmSync(backupFile(configDir), { force: true });
  return outcome;
}
