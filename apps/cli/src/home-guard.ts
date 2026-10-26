import { isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { claudeSettingsFile, debriefConfigDir } from './paths.js';

export interface GuardedDir {
  label: string;
  dir: string;
}

// The places the CLI writes to by default; a test that reaches one of them is a bug.
export function guardedDirs(env: NodeJS.ProcessEnv, home: string): GuardedDir[] {
  return [
    { label: 'Claude Code settings', dir: resolve(claudeSettingsFile(env, home), '..') },
    { label: 'Debrief config', dir: resolve(debriefConfigDir(env, home)) },
  ];
}

const inside = (path: string, dir: string): boolean => path === dir || path.startsWith(dir + sep);

const pathOf = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (value instanceof URL) return value.protocol === 'file:' ? fileURLToPath(value) : undefined;
  if (value instanceof Uint8Array) return Buffer.from(value).toString();
  return undefined;
};

export function guardedPath(
  value: unknown,
  guarded: readonly GuardedDir[],
): GuardedDir | undefined {
  const path = pathOf(value);
  if (path === undefined || !isAbsolute(path)) return undefined;
  const resolved = resolve(path);
  return guarded.find(({ dir }) => inside(resolved, dir));
}

export function assertOutsideHome(
  name: string,
  args: readonly unknown[],
  guarded: readonly GuardedDir[],
): void {
  for (const arg of args) {
    const hit = guardedPath(arg, guarded);
    if (hit !== undefined) {
      throw new Error(`fs.${name} touched the real ${hit.label} at ${String(pathOf(arg))}`);
    }
  }
}

type Fn = (...args: unknown[]) => unknown;

// Classes (fs.Stats, fs.ReadStream) keep `new` and `instanceof`; functions and their `.native` variants get the check.
const isClass = (key: string): boolean => /^[A-Z]/.test(key);

function guardFunction(key: string, fn: Fn, guarded: readonly GuardedDir[]): Fn {
  const wrapped = (...args: unknown[]): unknown => {
    assertOutsideHome(key, args, guarded);
    return fn(...args);
  };
  for (const prop of Object.keys(fn)) {
    const value: unknown = (fn as unknown as Record<string, unknown>)[prop];
    (wrapped as unknown as Record<string, unknown>)[prop] =
      typeof value === 'function' ? guardFunction(`${key}.${prop}`, value as Fn, guarded) : value;
  }
  return wrapped;
}

// Every path-taking function on the module gets the check; fd-taking ones see no string and pass.
export function guardModule<T extends object>(module: T, guarded: readonly GuardedDir[]): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(module)) {
    const value: unknown = (module as Record<string, unknown>)[key];
    out[key] =
      typeof value === 'function' && !isClass(key)
        ? guardFunction(key, value as Fn, guarded)
        : key === 'promises' && value !== null && typeof value === 'object'
          ? guardModule(value, guarded)
          : value;
  }
  return out as T;
}

export function tempHomeEnv(home: string): Record<string, string> {
  return {
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    DEBRIEF_CONFIG_DIR: join(home, '.config', 'debrief'),
    XDG_CONFIG_HOME: join(home, '.config'),
  };
}
