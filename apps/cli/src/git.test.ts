import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eventInputSchema } from '@debrief/schema';
import { afterAll, describe, expect, it } from 'vitest';

import {
  type GitResult,
  type GitRunner,
  type GitState,
  MAX_DIFFSTAT_FILES,
  gitDigest,
  gitEvent,
  parseNumstat,
  readGitState,
  runGit,
} from './git.js';

const SESSION = '5d1c7a90-1b2e-4c3d-9e8f-0a1b2c3d4e5f';
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
    expect(await readGitState('/', () => Promise.resolve({ ok: true, out: '' }))).toBeUndefined();
  });

  it('gives no state when git fails other than answering no commit or detached HEAD', async () => {
    const answers =
      (failing: string, result: GitResult): GitRunner =>
      (args) =>
        Promise.resolve(args.join(' ').startsWith(failing) ? result : { ok: true, out: '/r\n' });
    expect(await readGitState('/r', answers('diff', { ok: false }))).toBeUndefined();
    expect(
      await readGitState('/r', answers('ls-files', { ok: false, exitCode: 1 })),
    ).toBeUndefined();
    expect(
      await readGitState('/r', answers('symbolic-ref', { ok: false, exitCode: 128 })),
    ).toBeUndefined();
    expect(await readGitState('/r', answers('rev-parse --verify', { ok: false }))).toBeUndefined();
    expect(
      await readGitState('/r', answers('symbolic-ref', { ok: false, exitCode: 1 })),
    ).toMatchObject({
      head: '/r',
    });
  });

  it('tells git’s own exit codes from a kill, a missing directory or a timeout', async () => {
    const dir = repo();
    expect(await runGit(['rev-parse', '--verify', '-q', 'nope'], dir, 5000)).toEqual({
      ok: false,
      exitCode: 1,
    });
    expect(await runGit(['status'], join(dir, 'missing'), 5000)).toEqual({ ok: false });
    expect(await runGit(['hash-object', '--stdin'], dir, 200)).toEqual({ ok: false });
    expect(await runGit(['rev-parse', '--show-toplevel'], dir, 5000)).toMatchObject({ ok: true });
  });

  it('parses renames and skips empty fields', () => {
    expect(parseNumstat('1\t2\ta b.ts\0' + '0\t0\t\0from.ts\0to.ts\0' + '\0')).toEqual([
      { path: 'a b.ts', added: 1, removed: 2, untracked: false },
      { path: 'to.ts', added: 0, removed: 0, untracked: false },
    ]);
  });
});

describe('gitEvent', () => {
  const state: GitState = {
    repo: 'debrief',
    head: 'a'.repeat(40),
    branch: 'p62-claude-code-hook',
    files: [
      { path: 'src/a.ts', added: 3, removed: 1, untracked: false },
      { path: 'img.png', added: null, removed: null, untracked: false },
      { path: 'notes.md', added: null, removed: null, untracked: true },
    ],
  };

  it('posts an observed, locally trusted change with paths and counts only', () => {
    const event = gitEvent(state, SESSION, '2026-10-26T09:15:02.123Z');
    expect(event).toEqual({
      source: 'world-hook',
      provenance: 'observed',
      kind: 'world.change',
      sourceId: `git:${SESSION}:0:${gitDigest(state)}`,
      sourceTs: '2026-10-26T09:15:02.123Z',
      runId: SESSION,
      actor: { type: 'system', id: 'debrief-git-witness' },
      target: { system: 'git', resource: 'debrief', environment: 'dev', operation: 'git.state' },
      attrs: {
        'witness.trust': 'local',
        'git.repo': 'debrief',
        'git.files': 3,
        'git.untracked': 1,
        'git.lines.added': 3,
        'git.lines.removed': 1,
        'commit.sha': 'a'.repeat(40),
        'vcs.ref': 'refs/heads/p62-claude-code-hook',
        'git.diffstat': '3\t1\tsrc/a.ts\n-\t-\timg.png\n?\t?\tnotes.md',
      },
      summary: 'debrief at aaaaaaa on p62-claude-code-hook: 3 files changed (+3 −1)',
    });
    const { sourceId: _id, ...input } = event;
    const parsed = eventInputSchema.safeParse({
      ...input,
      id: '01JB2W6Q8R0S1T2V3W4X5Y6Z7A',
      ts: '2026-10-26T09:15:03.000Z',
      tenantId: 't1',
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('caps the diff stat, marks it truncated and changes the digest with the state', () => {
    const many: GitState = {
      repo: 'r',
      files: Array.from({ length: MAX_DIFFSTAT_FILES + 1 }, (_, n) => ({
        path: `f${String(n)}.ts`,
        added: 1,
        removed: 0,
        untracked: false,
      })),
    };
    const event = gitEvent(many, SESSION, '2026-10-26T09:15:02.123Z');
    expect(event.attrs['git.diffstat.truncated']).toBe(true);
    expect(String(event.attrs['git.diffstat']).split('\n')).toHaveLength(MAX_DIFFSTAT_FILES);
    expect(event.summary).toBe('r at no commit: 201 files changed (+201 −0)');
    expect(gitEvent({ repo: 'r', files: [] }, SESSION, 'x').attrs['git.diffstat']).toBeUndefined();
    expect(gitDigest(many)).not.toBe(gitDigest({ ...many, head: 'b'.repeat(40) }));
  });

  it('gives every revisit of a state its own id and a retry the same one', () => {
    const a: GitState = { repo: 'r', files: [] };
    const b: GitState = {
      repo: 'r',
      files: [{ path: 'x', added: 1, removed: 0, untracked: false }],
    };
    const ids = [a, b, a, b].map((state, n) => gitEvent(state, SESSION, 't', n).sourceId);
    expect(new Set(ids).size).toBe(4);
    expect(gitEvent(b, SESSION, 't', 3).sourceId).toBe(ids[3]);
  });
});
