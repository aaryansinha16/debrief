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

export type GitRunner = (args: readonly string[], cwd: string) => Promise<string | undefined>;

export const MAX_DIFFSTAT_FILES = 200;
export const MAX_DIFFSTAT_CHARS = 16 * 1024;

export const runGit: GitRunner = (args, cwd) =>
  new Promise((resolve) => {
    execFile('git', [...args], { cwd, timeout: 800, maxBuffer: 8 * 1024 * 1024 }, (error, out) => {
      resolve(error === null ? out : undefined);
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

export async function readGitState(cwd: string, git = runGit): Promise<GitState | undefined> {
  const top = (await git(['rev-parse', '--show-toplevel'], cwd))?.trim();
  if (top === undefined || top === '') return undefined;
  const head = (await git(['rev-parse', '--verify', '-q', 'HEAD'], top))?.trim();
  const [branch, numstat, untracked] = await Promise.all([
    git(['symbolic-ref', '--short', '-q', 'HEAD'], top),
    git(['diff', '--numstat', '-z', head === undefined ? '--cached' : 'HEAD', '--'], top),
    git(['ls-files', '--others', '--exclude-standard', '-z'], top),
  ]);
  const files = [
    ...parseNumstat(numstat ?? ''),
    ...(untracked ?? '')
      .split('\0')
      .filter((path) => path !== '')
      .map((path) => ({ path, added: null, removed: null, untracked: true })),
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const state: GitState = { repo: basename(top), files };
  if (head !== undefined && head !== '') state.head = head;
  const name = branch?.trim();
  if (name !== undefined && name !== '') state.branch = name;
  return state;
}

export const gitDigest = (state: GitState): string =>
  createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 32);

const line = (file: GitFile): string =>
  file.untracked
    ? `?\t?\t${file.path}`
    : `${String(file.added ?? '-')}\t${String(file.removed ?? '-')}\t${file.path}`;

// ARCHITECTURE §18.2: paths and line counts only, never file contents; local trust (D-084).
export function gitEvent(state: GitState, sessionId: string, now: string): WireEvent {
  const lines = state.files.slice(0, MAX_DIFFSTAT_FILES).map(line).join('\n');
  const diffstat = redactSecrets(lines).text.slice(0, MAX_DIFFSTAT_CHARS);
  const sum = (pick: (file: GitFile) => number | null): number =>
    state.files.reduce((total, file) => total + (pick(file) ?? 0), 0);
  const attrs: WireEvent['attrs'] = {
    'witness.trust': 'local',
    'git.repo': state.repo,
    'git.files': state.files.length,
    'git.untracked': state.files.filter((file) => file.untracked).length,
    'git.lines.added': sum((file) => file.added),
    'git.lines.removed': sum((file) => file.removed),
  };
  if (state.head !== undefined) attrs['commit.sha'] = state.head;
  if (state.branch !== undefined) attrs['vcs.ref'] = `refs/heads/${state.branch}`;
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
    sourceId: `git:${sessionId}:${gitDigest(state)}`,
    sourceTs: now,
    runId: sessionId,
    actor: { type: 'system', id: 'debrief-git-witness' },
    target: { system: 'git', resource: state.repo, environment: 'dev', operation: 'git.state' },
    attrs,
    summary: redactSecrets(summary).text.slice(0, 280),
  };
}
