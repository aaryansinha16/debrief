import { describe, expect, it } from 'vitest';

import {
  SHA_A,
  SHA_B,
  SHA_HUMAN,
  WINDOW,
  claim,
  ev,
  gitState,
  ist,
  witness,
  workflowRun,
} from './__fixtures__/index.js';
import {
  contextOf,
  diffstatLines,
  diffstatPaths,
  inWindow,
  isHuman,
  isLocalGitState,
  latestAttempts,
  num,
  observedIn,
  onLatestCommit,
  onSessionCommits,
  onSubject,
  op,
  str,
  summaryOf,
  thirdPartyOnly,
  tokenIn,
} from './select.js';

describe('select', () => {
  it('reads the operation and summary of events that may lack them', () => {
    const bare = ev({ n: 1, at: ist('14:00:00'), kind: 'tool.call', provenance: 'reported' });
    expect(op(bare)).toBe('');
    expect(summaryOf(bare)).toBe('');
    expect(op(witness({ n: 2, at: ist('14:00:00'), target: { system: 'x' }, summary: 's' }))).toBe(
      '',
    );
    expect(isLocalGitState(bare)).toBe(false);
    expect(isHuman(bare)).toBe(false);
    expect(isHuman({ ...bare, actor: { type: 'human', id: 'carol' } })).toBe(true);
    const github = { ...bare, target: { system: 'github' } };
    const subject = (system: string) =>
      ({ ...bare, target: { system }, params: {}, subject: { system } }) as never;
    expect(onSubject(subject('ci'), [bare, github])).toEqual([github]);
    expect(onSubject(subject('circleci'), [bare, github])).toEqual([]);
    expect(onSubject(subject('git'), [bare, github])).toEqual([github]);
    expect(onSubject(subject('repo'), [{ ...bare, target: { system: 'git' } }])).toHaveLength(1);
    expect(onSubject(subject('neon'), [{ ...bare, target: { system: 'neon' } }])).toHaveLength(1);
  });

  it('reads typed attrs and tests the window on the instant', () => {
    expect(str({ a: 'x', b: 1 }, 'a')).toBe('x');
    expect(str({ b: 1 }, 'b')).toBeUndefined();
    expect(num({ b: 1 }, 'b')).toBe(1);
    expect(num({ b: 'x', c: Number.NaN }, 'b')).toBeUndefined();
    expect(num({ c: Number.NaN }, 'c')).toBeUndefined();
    expect(inWindow(gitState(1, '2026-10-25T14:10:00.000+05:30', SHA_A, []), WINDOW)).toBe(true);
    expect(inWindow(gitState(1, '2026-10-25T14:09:59.000+05:30', SHA_A, []), WINDOW)).toBe(false);
  });

  it('keeps observed events inside the window once each, in timeline order', () => {
    const a = gitState(2, ist('14:30:00'), SHA_A, []);
    const b = gitState(1, ist('14:20:00'), SHA_A, []);
    const late = gitState(3, ist('15:00:00'), SHA_A, []);
    const reported = ev({ n: 4, at: ist('14:25:00'), kind: 'tool.call', provenance: 'reported' });
    const said = claim({
      n: 5,
      at: ist('14:25:00'),
      text: 't',
      predicate: 'unchecked',
      subject: { system: 'x' },
    });
    expect(observedIn([a, b, a, late, reported, said], WINDOW).map((e) => e.id)).toEqual([
      b.id,
      a.id,
    ]);
  });

  it('parses diff stats, tolerating short lines, dashes and tabs in paths', () => {
    const state = gitState(1, ist('14:20:00'), SHA_A, [
      [1, 2, 'a.ts'],
      ['-', '-', 'img.png'],
      ['?', '?', 'new\tname.md'],
    ]);
    expect(diffstatLines(state)).toEqual([
      { path: 'a.ts', added: 1, removed: 2 },
      { path: 'img.png', added: null, removed: null },
      { path: 'new\tname.md', added: null, removed: null },
    ]);
    expect(diffstatPaths(state)).toEqual(['a.ts', 'img.png', 'new']);
    const empty = gitState(2, ist('14:20:00'), SHA_A, []);
    expect(diffstatLines(empty)).toEqual([]);
    expect(diffstatPaths(empty)).toEqual([]);
    const odd = { ...empty, attrs: { ...empty.attrs, 'git.diffstat': 'x' } };
    expect(diffstatLines(odd)).toEqual([{ path: '', added: null, removed: null }]);
    expect(diffstatPaths(odd)).toEqual(['']);
  });

  it('takes the first HEAD as the base, later HEADs as the session’s commits, the last as latest', () => {
    const states = [
      gitState(1, ist('14:20:00'), SHA_HUMAN, [[1, 0, 'src/a.ts']]),
      gitState(2, ist('14:21:00'), SHA_A, []),
      gitState(3, ist('14:22:00'), SHA_B, []),
      {
        ...gitState(4, ist('14:23:00'), SHA_B, []),
        attrs: { 'witness.trust': 'local', 'git.diffstat': 'x' },
      },
      workflowRun({ n: 5, at: ist('14:23:00'), sha: 'c'.repeat(40), runId: 1 }),
    ];
    const ctx = contextOf(states, WINDOW);
    expect(ctx.witnessed).toBe(true);
    expect(ctx.baseCommit).toBe(SHA_HUMAN);
    expect([...ctx.commits]).toEqual([SHA_A, SHA_B]);
    expect(ctx.latestCommit).toBe(SHA_B);
    expect([...ctx.editedPaths]).toEqual(['src/a.ts']);
    expect(thirdPartyOnly(ctx).observed.map((e) => e.id)).toEqual([states[4]!.id]);
    expect(thirdPartyOnly(ctx).commits).toBe(ctx.commits);
    expect(onSessionCommits(ctx.observed, ctx).map((e) => e.seq)).toEqual([2, 3]);
    expect(onLatestCommit(ctx.observed, ctx).map((e) => e.seq)).toEqual([3]);
  });

  it('knows a session that never committed, one with no git witness, and states without a sha', () => {
    const stayed = contextOf(
      [gitState(1, ist('14:20:00'), SHA_HUMAN, []), gitState(2, ist('14:30:00'), SHA_HUMAN, [])],
      WINDOW,
    );
    expect(stayed).toMatchObject({
      witnessed: true,
      baseCommit: SHA_HUMAN,
      latestCommit: undefined,
    });
    expect(stayed.commits.size).toBe(0);
    const none = contextOf([], WINDOW);
    expect(none).toMatchObject({
      witnessed: false,
      baseCommit: undefined,
      latestCommit: undefined,
    });
    const unborn = {
      ...gitState(1, ist('14:20:00'), SHA_A, []),
      attrs: { 'witness.trust': 'local' },
    };
    const back = contextOf([unborn, gitState(2, ist('14:21:00'), SHA_A, []), unborn], WINDOW);
    expect(back).toMatchObject({ witnessed: true, baseCommit: SHA_A, latestCommit: undefined });
  });

  it('keeps only the latest attempt of each run across operations, and events without a run id', () => {
    const first = workflowRun({ n: 1, at: ist('14:20:00'), sha: SHA_A, runId: 7, attempt: 1 });
    const second = workflowRun({ n: 2, at: ist('14:25:00'), sha: SHA_A, runId: 7, attempt: 2 });
    const report = witness({
      n: 3,
      at: ist('14:25:01'),
      target: { system: 'github', operation: 'workflow_run.tests' },
      attrs: { 'github.run_id': 7, 'github.run_attempt': 1 },
      summary: 'attempt 1 report',
    });
    const other = witness({
      n: 4,
      at: ist('14:26:00'),
      target: { system: 'github', operation: 'workflow_run.completed' },
      attrs: { 'github.run_id': 8 },
      summary: 'no attempt',
    });
    const loose = witness({
      n: 5,
      at: ist('14:27:00'),
      target: { system: 'github' },
      summary: 'x',
    });
    expect(latestAttempts([second, first, report, other, loose]).map((e) => e.seq)).toEqual([
      2, 4, 5,
    ]);
  });

  it('matches a name as a whole token, escaping regex characters', () => {
    expect(tokenIn('0042', 'migration 0042 applied')).toBe(true);
    expect(tokenIn('0042', 'migration 00421 applied')).toBe(false);
    expect(tokenIn('0042', 'migrations/0042_add')).toBe(true);
    expect(tokenIn('a.b', 'ran a.b now')).toBe(true);
    expect(tokenIn('a.b', 'ran axb now')).toBe(false);
    expect(tokenIn('API key', 'billing/api-key')).toBe(true);
    expect(tokenIn('feature flag', 'src/feature-flag.ts')).toBe(true);
    expect(tokenIn('key', 'monkey-token')).toBe(false);
    expect(tokenIn(' ', 'anything')).toBe(false);
  });
});
