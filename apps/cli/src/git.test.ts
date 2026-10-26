import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { parseNumstat, readGitState } from './git.js';

const dirs: string[] = [];

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'debrief-git-'));
  dirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], {
      cwd: dir,
      stdio: 'ignore',
    });
  git('init', '-q', '-b', 'main');
  return dir;
}

const commit = (dir: string) =>
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', '-c', 'commit.gpgsign=false'].concat([
      'commit',
      '-qam',
      'init',
    ]),
    { cwd: dir, stdio: 'ignore' },
  );

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('readGitState', () => {
  it('reads HEAD, branch and a per-file diff stat of tracked and untracked files', async () => {
    const dir = repo();
    writeFileSync(join(dir, 'a.ts'), 'one\ntwo\n');
    writeFileSync(join(dir, 'old.ts'), 'x\n');
    writeFileSync(join(dir, 'bin.dat'), Buffer.from([0, 1, 2]));
    execFileSync('git', ['add', '.'], { cwd: dir });
    commit(dir);
    writeFileSync(join(dir, 'a.ts'), 'one\nthree\nfour\n');
    writeFileSync(join(dir, 'bin.dat'), Buffer.from([0, 9]));
    execFileSync('git', ['mv', 'old.ts', 'new.ts'], { cwd: dir });
    writeFileSync(join(dir, 'fresh.md'), 'hi\n');
    const state = await readGitState(dir);
    expect(state?.branch).toBe('main');
    expect(state?.head).toMatch(/^[0-9a-f]{40}$/);
    expect(state!.files).toEqual([
      { path: 'a.ts', added: 2, removed: 1, untracked: false },
      { path: 'bin.dat', added: null, removed: null, untracked: false },
      { path: 'fresh.md', added: null, removed: null, untracked: true },
      { path: 'new.ts', added: 0, removed: 0, untracked: false },
    ]);
  });

  it('handles a repository without commits and a directory outside any repository', async () => {
    const dir = repo();
    writeFileSync(join(dir, 'a.ts'), 'one\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    expect(await readGitState(dir)).toEqual({
      repo: expect.any(String) as string,
      branch: 'main',
      files: [{ path: 'a.ts', added: 1, removed: 0, untracked: false }],
    });
    expect(await readGitState(mkdtempSync(join(tmpdir(), 'debrief-nogit-')))).toBeUndefined();
    expect(await readGitState('/', () => Promise.resolve(''))).toBeUndefined();
  });

  it('parses renames and skips empty fields', () => {
    expect(parseNumstat('1\t2\ta b.ts\0' + '0\t0\t\0from.ts\0to.ts\0' + '\0')).toEqual([
      { path: 'a b.ts', added: 1, removed: 2, untracked: false },
      { path: 'to.ts', added: 0, removed: 0, untracked: false },
    ]);
  });
});
