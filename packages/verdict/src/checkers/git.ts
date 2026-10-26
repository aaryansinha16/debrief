import type { Event } from '@debrief/schema';

import { diffstatLines, isLocalGitState, num, summaryOf } from '../select.js';
import type { Checker, Finding } from '../types.js';
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

export const filesChanged: Checker = (claim, ctx): Finding => {
  const states = ctx.observed.filter(isLocalGitState);
  if (states.length === 0) return noWitness(NO_GIT);
  const path = typeof claim.params.path === 'string' ? claim.params.path : undefined;
  const count = typeof claim.params.count === 'number' ? claim.params.count : undefined;
  if (EXCLUSIVE.test(claim.text)) {
    if (path === undefined) return noWitness('the claim names no path to hold it to');
    const others = seenPaths(states).filter((p) => !samePath(p, path));
    return others.length === 0 && states.some((s) => touching(s, path))
      ? {
          outcome: 'holds',
          evidence: states,
          reason: `the working copy changed ${path} and nothing else`,
        }
      : noWitness(
          `the working copy also showed changes to ${others.slice(0, 8).join(', ') || 'nothing'}, and no witness tells which were the session's`,
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
