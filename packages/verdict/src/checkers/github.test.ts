import { describe, expect, it } from 'vitest';

import {
  SHA_A,
  SHA_B,
  WINDOW,
  claim,
  gitState,
  ist,
  prOpened,
  push,
  witness,
} from '../__fixtures__/index.js';
import { verdicts } from '../check.js';

const at = ist('14:30:05');
const git = gitState(10, ist('14:26:00'), SHA_B, []);
const one = (events: Parameters<typeof verdicts>[0]['events']) =>
  verdicts({ events, window: WINDOW })[0]!;
const pr = (params: Record<string, string | number> = {}) =>
  claim({
    n: 1,
    at,
    text: 'Opened a PR.',
    predicate: 'pr.opened',
    subject: { system: 'github' },
    params,
  });
const pushed = (params: Record<string, string | number> = {}) =>
  claim({
    n: 2,
    at,
    text: 'Pushed.',
    predicate: 'commit.pushed',
    subject: { system: 'github' },
    params,
  });

describe('pr.opened', () => {
  it('holds on the numbered PR, or on any PR opened from the session’s commits', () => {
    const opened = prOpened(11, at, 311, SHA_B);
    expect(one([pr({ number: 311 }), opened])).toMatchObject({
      outcome: 'holds',
      trust: 'third-party',
      evidence: [opened.id],
    });
    expect(one([pr(), git, opened])).toMatchObject({ outcome: 'holds', evidence: [opened.id] });
    expect(one([pr()]).reason).toBe(
      'no GitHub witness recorded a pull request opened in the window',
    );
  });

  it('never contradicts from silence: a different number or commit is no-witness naming what it saw', () => {
    const other = prOpened(11, at, 312, SHA_A);
    const numberless = witness({
      n: 12,
      at,
      target: { system: 'github', operation: 'pull_request.opened' },
      summary: 'x',
    });
    expect(one([pr({ number: 311 }), other, numberless]).reason).toBe(
      'GitHub recorded no pull request #311 opened in the window (opened: #312, #?)',
    );
    expect(one([pr(), git, other]).reason).toBe(
      "GitHub recorded pull requests #312 opened in the window, none on this session's commits (b7d4e90)",
    );
    expect(one([pr(), other]).reason).toMatch(/\(no local git witness\)$/);
  });
});

describe('commit.pushed', () => {
  it('holds when a session commit was pushed, to the named branch when one is given', () => {
    const mine = push(11, at, SHA_B, 'fix/invoices');
    expect(one([pushed(), git, mine])).toMatchObject({ outcome: 'holds', evidence: [mine.id] });
    expect(one([pushed({ branch: 'fix/invoices' }), git, mine]).outcome).toBe('holds');
    expect(one([pushed({ branch: 'refs/heads/fix/invoices' }), git, mine]).outcome).toBe('holds');
    expect(one([pushed({ branch: 'main' }), git, mine]).reason).toBe(
      "this session's commits were pushed to fix/invoices, not main",
    );
  });

  it('names the missing witness or binding, and a push of someone else’s commit', () => {
    expect(one([pushed()]).reason).toBe('no GitHub witness recorded a push in the window');
    const theirs = push(11, at, SHA_A, 'main', 'carol-rev');
    expect(one([pushed(), theirs]).reason).toMatch(/no local git witness bound/);
    expect(one([pushed(), git, theirs]).reason).toBe(
      "GitHub recorded pushes in the window, none of this session's commits (b7d4e90)",
    );
    const refless = witness({
      n: 12,
      at,
      target: { system: 'github', operation: 'create.branch' },
      attrs: { 'commit.sha': SHA_B },
      summary: 'x',
    });
    expect(one([pushed({ branch: 'main' }), git, refless]).reason).toMatch(
      /pushed to \?, not main/,
    );
    expect(one([pushed(), git, refless]).outcome).toBe('holds');
  });
});
