import type { Event } from '@debrief/schema';

import { commitsText, num, onSessionCommits, op, str, summaryOf } from '../select.js';
import type { Checker, Finding } from '../types.js';
import { noWitness } from './ci.js';

const prNumber = (event: Event): number | undefined => num(event.attrs, 'github.pr.number');

export const prOpened: Checker = (claim, ctx): Finding => {
  const opened = ctx.observed.filter((e) => op(e) === 'pull_request.opened');
  if (opened.length === 0) {
    return noWitness('no GitHub witness recorded a pull request opened in the window');
  }
  const wanted = typeof claim.params.number === 'number' ? claim.params.number : undefined;
  const found =
    wanted === undefined
      ? onSessionCommits(opened, ctx)
      : opened.filter((e) => prNumber(e) === wanted);
  if (found.length > 0) {
    return {
      outcome: 'holds',
      evidence: found,
      reason: found.map(summaryOf).join('; '),
    };
  }
  const seen = opened.map((e) => `#${String(prNumber(e) ?? '?')}`).join(', ');
  return noWitness(
    wanted === undefined
      ? `GitHub recorded pull requests ${seen} opened in the window, none on this session's commits (${commitsText(ctx) || 'no local git witness'})`
      : `GitHub recorded no pull request #${String(wanted)} opened in the window (opened: ${seen})`,
  );
};

const refTail = (ref: string): string => ref.replace(/^refs\/heads\//, '');

export const commitPushed: Checker = (claim, ctx): Finding => {
  const pushes = ctx.observed.filter((e) => /^(?:push|create)\.branch$/.test(op(e)));
  if (pushes.length === 0) {
    return noWitness('no GitHub witness recorded a push in the window');
  }
  if (ctx.commits.size === 0) {
    return noWitness(
      'no local git witness bound this session to a commit, so pushes cannot be matched to it (install the Claude Code hook)',
    );
  }
  const branch = typeof claim.params.branch === 'string' ? claim.params.branch : undefined;
  const mine = onSessionCommits(pushes, ctx);
  const found = mine.filter(
    (e) => branch === undefined || refTail(str(e.attrs, 'vcs.ref') ?? '') === refTail(branch),
  );
  if (found.length > 0) {
    return { outcome: 'holds', evidence: found, reason: found.map(summaryOf).join('; ') };
  }
  const refs = mine.map((e) => refTail(str(e.attrs, 'vcs.ref') ?? '?')).join(', ');
  return noWitness(
    mine.length === 0
      ? `GitHub recorded pushes in the window, none of this session's commits (${commitsText(ctx)})`
      : `this session's commits were pushed to ${refs}, not ${String(branch)}`,
  );
};
