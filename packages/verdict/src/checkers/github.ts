import type { Event } from '@debrief/schema';

import { num, onSessionCommits, onSubject, op, str, summaryOf } from '../select.js';
import type { Checker, ClaimRecord, Context, Finding } from '../types.js';
import { NO_GIT, headStayed, noWitness } from './ci.js';

const prNumber = (event: Event): number | undefined => num(event.attrs, 'github.pr.number');

const repoName = (repo: string): string => repo.slice(repo.lastIndexOf('/') + 1).toLowerCase();

// The claim's resource is grounded in the transcript, so "billing-api" and "acme-demo/billing-api" both name the repo.
const sameRepo = (claim: ClaimRecord, event: Event): boolean => {
  const wanted = claim.subject.resource;
  const repo = str(event.attrs, 'github.repo');
  if (wanted === undefined) return true;
  return repo !== undefined && (repo === wanted || repoName(repo) === repoName(wanted));
};

const unbound = (ctx: Context): Finding | undefined =>
  !ctx.witnessed
    ? noWitness(NO_GIT)
    : ctx.commits.size === 0
      ? headStayed(ctx, 'nothing on GitHub is bound to it')
      : undefined;

export const prOpened: Checker = (claim, ctx): Finding => {
  const opened = onSubject(claim, ctx.observed).filter((e) => op(e) === 'pull_request.opened');
  if (opened.length === 0) {
    return noWitness('no GitHub witness recorded a pull request opened in the window');
  }
  const missing = unbound(ctx);
  if (missing !== undefined) return missing;
  const wanted = typeof claim.params.number === 'number' ? claim.params.number : undefined;
  const mine = onSessionCommits(opened, ctx).filter((e) => sameRepo(claim, e));
  const found = mine.filter((e) => wanted === undefined || prNumber(e) === wanted);
  if (found.length > 0) {
    return { outcome: 'holds', evidence: found, reason: found.map(summaryOf).join('; ') };
  }
  const seen = opened
    .map((e) => `#${String(prNumber(e) ?? '?')} on ${str(e.attrs, 'github.repo') ?? '?'}`)
    .join(', ');
  return noWitness(
    `GitHub recorded pull requests ${seen} opened in the window, ${wanted === undefined ? 'none' : `no #${String(wanted)}`} from this session's commits`,
  );
};

const refTail = (ref: string): string => ref.replace(/^refs\/heads\//, '');

export const commitPushed: Checker = (claim, ctx): Finding => {
  const pushes = onSubject(claim, ctx.observed).filter((e) =>
    /^(?:push|create)\.branch$/.test(op(e)),
  );
  if (pushes.length === 0) {
    return noWitness('no GitHub witness recorded a push in the window');
  }
  const missing = unbound(ctx);
  if (missing !== undefined) return missing;
  const branch = typeof claim.params.branch === 'string' ? claim.params.branch : undefined;
  const mine = onSessionCommits(pushes, ctx).filter((e) => sameRepo(claim, e));
  const found = mine.filter(
    (e) => branch === undefined || refTail(str(e.attrs, 'vcs.ref') ?? '') === refTail(branch),
  );
  if (found.length > 0) {
    return { outcome: 'holds', evidence: found, reason: found.map(summaryOf).join('; ') };
  }
  const refs = mine.map((e) => refTail(str(e.attrs, 'vcs.ref') ?? '?')).join(', ');
  return noWitness(
    mine.length === 0
      ? "GitHub recorded pushes in the window, none of this session's commits"
      : `this session's commits were pushed to ${refs}, not ${String(branch)}`,
  );
};
