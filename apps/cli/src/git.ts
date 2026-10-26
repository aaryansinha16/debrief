import { execFile } from 'node:child_process';
import { basename } from 'node:path';

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
