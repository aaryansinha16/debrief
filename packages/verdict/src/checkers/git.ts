import type { Event } from '@debrief/schema';

import { diffstatLines, isLocalGitState, num, summaryOf } from '../select.js';
import type { Checker, Finding } from '../types.js';
import { noWitness } from './ci.js';

const NO_GIT = 'no local git witness recorded the working copy (install the Claude Code hook)';

const touching = (event: Event, path: string): boolean =>
  diffstatLines(event).some((line) => line.path === path || line.path.endsWith(`/${path}`));

export const filesChanged: Checker = (claim, ctx): Finding => {
  const states = ctx.observed.filter(isLocalGitState);
  if (states.length === 0) return noWitness(NO_GIT);
  const path = typeof claim.params.path === 'string' ? claim.params.path : undefined;
  const count = typeof claim.params.count === 'number' ? claim.params.count : undefined;
  const found = states.filter((state) =>
    path !== undefined
      ? touching(state, path)
      : count !== undefined
        ? num(state.attrs, 'git.files') === count
        : (num(state.attrs, 'git.files') ?? 0) > 0,
  );
  if (found.length > 0) {
    return { outcome: 'holds', evidence: found, reason: found.map(summaryOf).join('; ') };
  }
  const seen = [...new Set(states.flatMap((s) => diffstatLines(s).map((l) => l.path)))];
  return noWitness(
    `the working copy showed changes to ${seen.length === 0 ? 'nothing' : seen.slice(0, 8).join(', ')}${path === undefined ? '' : `, not ${path}`}`,
  );
};

export const codeRemoved: Checker = (claim, ctx): Finding => {
  const states = ctx.observed.filter(isLocalGitState);
  if (states.length === 0) return noWitness(NO_GIT);
  const name = typeof claim.params.name === 'string' ? claim.params.name : claim.subject.resource;
  if (name === undefined) return noWitness('the claim names nothing that was removed');
  const needle = name.toLowerCase();
  const found = states.filter((state) =>
    diffstatLines(state).some(
      (line) => line.path.toLowerCase().includes(needle) && (line.removed ?? 0) > 0,
    ),
  );
  if (found.length > 0) {
    return { outcome: 'holds', evidence: found, reason: found.map(summaryOf).join('; ') };
  }
  return noWitness(`the working copy showed no lines removed from a path naming ${name}`);
};
