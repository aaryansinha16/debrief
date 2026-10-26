import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';

import { redactSecrets } from '@debrief/schema';

import type { WireEvent } from './wire.js';

export interface GitFile {
  path: string;
  added: number | null;
  removed: number | null;
  untracked: boolean;
}

export interface GitState {
  repo: string;
  head?: string;
  branch?: string;
  files: GitFile[];
}

export type GitResult = { ok: true; out: string } | { ok: false; exitCode?: number };

export type GitRunner = (
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
) => Promise<GitResult>;

export const MAX_DIFFSTAT_FILES = 200;
export const MAX_DIFFSTAT_CHARS = 16 * 1024;

export const GIT_TIMEOUT_MS = 800;

// GIT_OPTIONAL_LOCKS=0: never take index.lock, so a commit the user runs meanwhile cannot fail on it.
export const runGit: GitRunner = (args, cwd, timeoutMs) =>
  new Promise((resolve) => {
    const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
    const options = { cwd, env, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 };
    execFile('git', [...args], options, (error, out) => {
      if (error === null) resolve({ ok: true, out });
      else if (typeof error.code === 'number' && error.killed !== true) {
        resolve({ ok: false, exitCode: error.code });
      } else resolve({ ok: false });
    });
  });

const count = (field: string): number | null => (/^\d+$/.test(field) ? Number(field) : null);

// `git diff --numstat -z`: "added\tremoved\tpath\0", or "added\tremoved\t\0from\0to\0" for a rename.
export function parseNumstat(output: string): GitFile[] {
  const fields = output.split('\0');
  const files: GitFile[] = [];
  for (let at = 0; at < fields.length; at += 1) {
    const [added = '', removed = '', path = ''] = (fields[at] ?? '').split('\t');
    if (added === '') continue;
    const renamed = path === '' ? (fields[at + 2] ?? '') : path;
    if (path === '') at += 2;
    files.push({ path: renamed, added: count(added), removed: count(removed), untracked: false });
  }
  return files;
}

// Exit 1 is git's answer for "no commit yet" or "detached HEAD"; any other failure means no witness.
const answered = (result: GitResult): boolean => result.ok || result.exitCode === 1;
const output = (result: GitResult): string => (result.ok ? result.out.trim() : '');

export async function readGitState(
  cwd: string,
  git = runGit,
  timeoutMs = GIT_TIMEOUT_MS,
): Promise<GitState | undefined> {
  const run = (args: readonly string[], at: string) => git(args, at, timeoutMs);
  const top = output(await run(['rev-parse', '--show-toplevel'], cwd));
  if (top === '') return undefined;
  const headResult = await run(['rev-parse', '--verify', '-q', 'HEAD'], top);
  const head = output(headResult);
  const [branch, numstat, untracked] = await Promise.all([
    run(['symbolic-ref', '--short', '-q', 'HEAD'], top),
    run(['diff', '--numstat', '-z', head === '' ? '--cached' : 'HEAD', '--'], top),
    run(['ls-files', '--others', '--exclude-standard', '-z'], top),
  ]);
  if (!answered(headResult) || !answered(branch) || !numstat.ok || !untracked.ok) return undefined;
  const files = [
    ...parseNumstat(numstat.out),
    ...untracked.out
      .split('\0')
      .filter((path) => path !== '')
      .map((path) => ({ path, added: null, removed: null, untracked: true })),
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const state: GitState = { repo: basename(top), files };
  if (head !== '') state.head = head;
  if (output(branch) !== '') state.branch = output(branch);
  return state;
}

export const gitDigest = (state: GitState): string =>
  createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 32);

const line = (file: GitFile): string =>
  file.untracked
    ? `?\t?\t${file.path}`
    : `${String(file.added ?? '-')}\t${String(file.removed ?? '-')}\t${file.path}`;

// ARCHITECTURE §18.2: paths and line counts only, never file contents; local trust (D-084).
// The per-session sequence is part of the id, so revisiting an earlier state is a new event; a retry dedupes.
export function gitEvent(state: GitState, sessionId: string, now: string, sequence = 0): WireEvent {
  const lines = state.files.slice(0, MAX_DIFFSTAT_FILES).map(line).join('\n');
  const diffstat = redactSecrets(lines).text.slice(0, MAX_DIFFSTAT_CHARS);
  const sum = (pick: (file: GitFile) => number | null): number =>
    state.files.reduce((total, file) => total + (pick(file) ?? 0), 0);
  const attrs: WireEvent['attrs'] = {
    'witness.trust': 'local',
    'git.repo': redactSecrets(state.repo).text,
    'git.files': state.files.length,
    'git.untracked': state.files.filter((file) => file.untracked).length,
    'git.lines.added': sum((file) => file.added),
    'git.lines.removed': sum((file) => file.removed),
  };
  if (state.head !== undefined) attrs['commit.sha'] = state.head;
  if (state.branch !== undefined) {
    attrs['vcs.ref'] = redactSecrets(`refs/heads/${state.branch}`).text;
  }
  if (diffstat !== '') attrs['git.diffstat'] = diffstat;
  if (diffstat.length < lines.length || state.files.length > MAX_DIFFSTAT_FILES) {
    attrs['git.diffstat.truncated'] = true;
  }
  const at = state.head === undefined ? 'no commit' : state.head.slice(0, 7);
  const on = state.branch === undefined ? '' : ` on ${state.branch}`;
  const summary = `${state.repo} at ${at}${on}: ${String(state.files.length)} files changed (+${String(attrs['git.lines.added'])} −${String(attrs['git.lines.removed'])})`;
  return {
    source: 'world-hook',
    provenance: 'observed',
    kind: 'world.change',
    sourceId: `git:${sessionId}:${String(sequence)}:${gitDigest(state)}`,
    sourceTs: now,
    runId: sessionId,
    actor: { type: 'system', id: 'debrief-git-witness' },
    target: {
      system: 'git',
      resource: redactSecrets(state.repo).text,
      environment: 'dev',
      operation: 'git.state',
    },
    attrs,
    summary: redactSecrets(summary).text.slice(0, 280),
  };
}
