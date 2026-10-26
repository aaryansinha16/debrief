import { isAbsolute, join, resolve, sep } from 'node:path';

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

export function guardedPath(
  value: unknown,
  guarded: readonly GuardedDir[],
): GuardedDir | undefined {
  if (typeof value !== 'string' || !isAbsolute(value)) return undefined;
  const path = resolve(value);
  return guarded.find(({ dir }) => inside(path, dir));
}

export function assertOutsideHome(
  name: string,
  args: readonly unknown[],
  guarded: readonly GuardedDir[],
): void {
  for (const arg of args) {
    const hit = guardedPath(arg, guarded);
    if (hit !== undefined) {
      throw new Error(`fs.${name} touched the real ${hit.label} at ${String(arg)}`);
    }
  }
}

type Fn = (...args: unknown[]) => unknown;

// Every path-taking function on the module gets the check; fd-taking ones see no string and pass.
export function guardModule<T extends object>(module: T, guarded: readonly GuardedDir[]): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(module)) {
    const value: unknown = (module as Record<string, unknown>)[key];
    out[key] =
      typeof value === 'function'
        ? Object.assign((...args: unknown[]) => {
            assertOutsideHome(key, args, guarded);
            return (value as Fn)(...args);
          }, value)
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
