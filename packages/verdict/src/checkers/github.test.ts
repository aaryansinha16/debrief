import { describe, expect, it } from 'vitest';

import {
  SHA_A,
  SHA_B,
  SHA_HUMAN,
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
const base = gitState(9, ist('14:10:30'), SHA_HUMAN, []);
const git = gitState(10, ist('14:26:00'), SHA_B, []);
const one = (events: Parameters<typeof verdicts>[0]['events']) =>
  verdicts({ events, window: WINDOW })[0]!;
const pr = (params: Record<string, string | number> = {}, resource?: string) =>
  claim({
    n: 1,
    at,
    text: 'Opened a PR.',
    predicate: 'pr.opened',
    subject: { system: 'github', ...(resource === undefined ? {} : { resource }) },
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
  it('holds on a PR opened from the session’s commits, with the number and repo when given', () => {
    const opened = prOpened(11, at, 311, SHA_B);
    expect(one([pr({ number: 311 }), base, git, opened])).toMatchObject({
      outcome: 'holds',
      trust: 'third-party',
      evidence: [opened.id],
    });
    expect(one([pr(), base, git, opened])).toMatchObject({
      outcome: 'holds',
      evidence: [opened.id],
    });
    expect(one([pr({}, 'billing-api'), base, git, opened]).outcome).toBe('holds');
    expect(one([pr({}, 'acme-demo/billing-api'), base, git, opened]).outcome).toBe('holds');
    expect(one([pr({}, 'billing-web'), base, git, opened]).outcome).toBe('no-witness');
    const { 'github.repo': _r, ...noRepo } = opened.attrs;
    expect(one([pr({}, 'billing-api'), base, git, { ...opened, attrs: noRepo }]).outcome).toBe(
      'no-witness',
    );
  });

  it('never contradicts from silence, and never binds a PR to the session without its commits', () => {
    expect(one([pr()]).reason).toBe(
      'no GitHub witness recorded a pull request opened in the window',
    );
    const theirs = prOpened(11, at, 311, SHA_HUMAN);
    expect(one([pr({ number: 311 }), theirs]).reason).toMatch(/^no local git witness/);
    expect(one([pr({ number: 311 }), base, theirs]).reason).toBe(
      "the session's HEAD stayed at c0ffee5, the commit it started from; nothing on GitHub is bound to it",
    );
    const other = prOpened(12, at, 312, SHA_A);
    const numberless = witness({
      n: 13,
      at,
      target: { system: 'github', operation: 'pull_request.opened' },
      summary: 'x',
    });
    expect(one([pr({ number: 311 }), base, git, theirs, other, numberless]).reason).toBe(
      "GitHub recorded pull requests #311 on acme-demo/billing-api, #312 on acme-demo/billing-api, #? on ? opened in the window, no #311 from this session's commits",
    );
    expect(one([pr(), base, git, other]).reason).toMatch(/, none from this session's commits$/);
  });
});

describe('commit.pushed', () => {
  it('holds when a session commit was pushed, to the named branch when one is given', () => {
    const mine = push(11, at, SHA_B, 'fix/invoices');
    expect(one([pushed(), base, git, mine])).toMatchObject({
      outcome: 'holds',
      evidence: [mine.id],
    });
    expect(one([pushed({ branch: 'fix/invoices' }), base, git, mine]).outcome).toBe('holds');
    expect(one([pushed({ branch: 'refs/heads/fix/invoices' }), base, git, mine]).outcome).toBe(
      'holds',
    );
    expect(one([pushed({ branch: 'main' }), base, git, mine]).reason).toBe(
      "this session's commits were pushed to fix/invoices, not main",
    );
  });

  it('names the missing witness or binding, and a push of someone else’s commit', () => {
    expect(one([pushed()]).reason).toBe('no GitHub witness recorded a push in the window');
    const theirs = push(11, at, SHA_HUMAN, 'main', 'carol-rev');
    expect(one([pushed(), theirs]).reason).toMatch(/^no local git witness/);
    expect(one([pushed(), base, theirs]).reason).toMatch(/HEAD stayed at c0ffee5/);
    expect(one([pushed(), base, git, theirs]).reason).toBe(
      "GitHub recorded pushes in the window, none of this session's commits",
    );
    const refless = witness({
      n: 12,
      at,
      target: { system: 'github', operation: 'create.branch' },
      attrs: { 'commit.sha': SHA_B },
      summary: 'x',
    });
    expect(one([pushed({ branch: 'main' }), base, git, refless]).reason).toMatch(
      /pushed to \?, not main/,
    );
    expect(one([pushed(), base, git, refless]).outcome).toBe('holds');
  });
});
