import type { Event } from '@debrief/schema';

import { diffstatLines, isLocalGitState, num, onSubject, summaryOf, tokenIn } from '../select.js';
import type { Checker, ClaimRecord, Context, Finding } from '../types.js';
import { noWitness } from './ci.js';

const NO_GIT = 'no local git witness recorded the working copy (install the Claude Code hook)';

// "Only", "just", "nothing else": a scope claim about files; the diff may carry changes made before the session.
const EXCLUSIVE = /\b(?:only|just|nothing else|no other)\b/i;

const samePath = (line: string, path: string): boolean =>
  line === path || line.endsWith(`/${path}`);

const touching = (event: Event, path: string): boolean =>
  diffstatLines(event).some((line) => samePath(line.path, path));

const seenPaths = (states: readonly Event[]): string[] => [
  ...new Set(states.flatMap((s) => diffstatLines(s).map((l) => l.path))),
];

const statesFor = (claim: ClaimRecord, ctx: Context): Event[] =>
  onSubject(claim, ctx.observed).filter(isLocalGitState);

export const filesChanged: Checker = (claim, ctx): Finding => {
  const states = statesFor(claim, ctx);
  if (states.length === 0) return noWitness(NO_GIT);
  const path = typeof claim.params.path === 'string' ? claim.params.path : undefined;
  const count = typeof claim.params.count === 'number' ? claim.params.count : undefined;
  if (EXCLUSIVE.test(claim.text)) {
    if (path === undefined) return noWitness('the claim names no path to hold it to');
    const seen = seenPaths(states);
    return seen.length === 1 && seen.every((p) => samePath(p, path))
      ? {
          outcome: 'holds',
          evidence: states,
          reason: `the working copy changed ${path} and nothing else`,
        }
      : noWitness(
          `the working copy showed changes to ${seen.slice(0, 8).join(', ') || 'nothing'}, and no witness tells which were the session's`,
        );
  }
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
  const seen = seenPaths(states);
  return noWitness(
    `the working copy showed changes to ${seen.length === 0 ? 'nothing' : seen.slice(0, 8).join(', ')}${path === undefined ? '' : `, not ${path}`}`,
  );
};

export const codeRemoved: Checker = (claim, ctx): Finding => {
  const states = statesFor(claim, ctx);
  if (states.length === 0) return noWitness(NO_GIT);
  const name = typeof claim.params.name === 'string' ? claim.params.name : claim.subject.resource;
  if (name === undefined) return noWitness('the claim names nothing that was removed');
  const found = states.filter((state) =>
    diffstatLines(state).some((line) => tokenIn(name, line.path) && (line.removed ?? 0) > 0),
  );
  if (found.length > 0) {
    return { outcome: 'holds', evidence: found, reason: found.map(summaryOf).join('; ') };
  }
  return noWitness(`the working copy showed no lines removed from a path naming ${name}`);
};
