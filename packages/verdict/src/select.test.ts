import { describe, expect, it } from 'vitest';

import {
  SHA_A,
  SHA_B,
  WINDOW,
  claim,
  ev,
  gitState,
  ist,
  witness,
  workflowRun,
} from './__fixtures__/index.js';
import {
  commitsText,
  contextOf,
  diffstatLines,
  diffstatPaths,
  inWindow,
  isLocalGitState,
  latestAttempts,
  num,
  observedIn,
  onSessionCommits,
  op,
  str,
  summaryOf,
  thirdPartyOnly,
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

  it('binds the session to its git commits and edited paths, never to other systems', () => {
    const states = [
      gitState(1, ist('14:20:00'), SHA_A, [[1, 0, 'src/a.ts']]),
      gitState(2, ist('14:21:00'), SHA_B, []),
      {
        ...gitState(3, ist('14:22:00'), SHA_B, []),
        attrs: { 'witness.trust': 'local', 'git.diffstat': 'x' },
      },
      workflowRun({ n: 4, at: ist('14:23:00'), sha: 'c'.repeat(40), runId: 1 }),
    ];
    const ctx = contextOf(states, WINDOW);
    expect([...ctx.commits]).toEqual([SHA_A, SHA_B]);
    expect([...ctx.editedPaths]).toEqual(['src/a.ts']);
    expect(commitsText(ctx)).toBe('a1b2c3d, b7d4e90');
    expect(thirdPartyOnly(ctx).observed.map((e) => e.id)).toEqual([states[3]!.id]);
    expect(thirdPartyOnly(ctx).commits).toBe(ctx.commits);
    expect(onSessionCommits(ctx.observed, ctx).map((e) => e.seq)).toEqual([1, 2]);
  });

  it('keeps only the latest attempt of each run, and every event without a run id', () => {
    const first = workflowRun({ n: 1, at: ist('14:20:00'), sha: SHA_A, runId: 7, attempt: 1 });
    const second = workflowRun({ n: 2, at: ist('14:25:00'), sha: SHA_A, runId: 7, attempt: 2 });
    const twin = workflowRun({ n: 3, at: ist('14:25:01'), sha: SHA_A, runId: 7, attempt: 2 });
    const other = witness({
      n: 4,
      at: ist('14:26:00'),
      target: { system: 'github', operation: 'workflow_run.completed' },
      attrs: { 'github.run_id': 7 },
      summary: 'no attempt',
    });
    const loose = witness({
      n: 5,
      at: ist('14:27:00'),
      target: { system: 'github' },
      summary: 'x',
    });
    expect(latestAttempts([second, first, twin, other, loose]).map((e) => e.seq)).toEqual([
      2, 3, 5,
    ]);
    expect(latestAttempts([other, first]).map((e) => e.seq)).toEqual([1]);
  });
});
