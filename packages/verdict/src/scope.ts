import type { Event } from '@debrief/schema';

import { str } from './select.js';
import type { ClaimRecord } from './types.js';

// Tools that run on the agent's machine: what they printed there is no CI run's to confirm.
const LOCAL_SYSTEMS = new Set([
  'local',
  'shell',
  'terminal',
  'pnpm',
  'npm',
  'npx',
  'yarn',
  'bun',
  'turbo',
  'nx',
  'vitest',
  'jest',
  'mocha',
  'playwright',
  'cypress',
  'eslint',
  'prettier',
  'tsc',
  'typescript',
  'node',
  'pytest',
  'cargo',
  'make',
]);
const LOCAL_WORDS =
  /\blocal(?:ly)?\b|\bon my machine\b|\bin (?:the|my|this) (?:worktree|checkout|working copy)\b/i;
const COMMAND =
  /`(?:pnpm|npm|npx|yarn|bun|turbo|nx|vitest|jest|mocha|playwright|cypress|eslint|prettier|tsc|node|pytest|cargo|go|make)\b[^`]*`/i;
const CI_WORDS = /\b(?:ci|github actions|actions|workflows?|pipelines?|check runs?|run #?\d+)\b/i;

// A claim about a command the agent ran is about its own machine, unless it says the run was CI's.
export const isLocalRun = (claim: ClaimRecord): boolean =>
  LOCAL_SYSTEMS.has(claim.subject.system.toLowerCase()) ||
  ((LOCAL_WORDS.test(claim.text) || COMMAND.test(claim.text)) && !CI_WORDS.test(claim.text));

const FILTER = /(?:--filter[= ]|--workspace[= ]|--project[= ]|(?:^|\s)-[Fw]\s+)['"]?([^\s'"`,;)]+)/;
const PACKAGE = /^@[\w.-]+\/[\w.-]+$/;
const PATH = /^[\w.@-]+(?:\/[\w.@-]+)+$/;
const FILE = /\.(?:[cm]?[jt]sx?|py|go|rs|rb|java|kt|php|cs)$/i;
const REF = /^(?:pr\s*)?#?\d+$|^[0-9a-f]{7,40}$/i;
const WHOLE = new Set([
  'ci',
  'test',
  'tests',
  'actions',
  'github actions',
  'repo',
  'repository',
  'all',
]);

const repoOf = (event: Event): string | undefined => str(event.attrs, 'github.repo');
const branchOf = (event: Event): string | undefined =>
  str(event.attrs, 'vcs.ref')?.replace(/^refs\/heads\//, '');

export const reposOf = (events: readonly Event[]): string =>
  [...new Set(events.map(repoOf).filter((repo) => repo !== undefined))].join(', ') ||
  'the repository';

// A name the CI evidence answers for as a whole: its repository, a branch or workflow it ran, a PR number or a commit.
function wholeRepo(name: string, ci: readonly Event[]): boolean {
  const n = name
    .toLowerCase()
    .replace(/#\d+$/, '')
    .replace(/^(?:origin|refs\/heads)\//, '');
  if (n === '' || WHOLE.has(n) || REF.test(name.trim())) return true;
  return ci.some((event) => {
    const repo = repoOf(event)?.toLowerCase();
    return (
      repo === n ||
      repo?.split('/').at(-1) === n ||
      branchOf(event)?.toLowerCase() === n ||
      str(event.attrs, 'github.workflow')?.toLowerCase() === n
    );
  });
}

const narrower = (token: string): boolean =>
  PACKAGE.test(token) || PATH.test(token) || FILE.test(token);

// The package or path a claim is about when it is narrower than the run that tested the whole repository (P-64.1).
export function narrowScope(claim: ClaimRecord, ci: readonly Event[]): string | undefined {
  const resource = claim.subject.resource?.trim();
  if (resource !== undefined && resource !== '' && !wholeRepo(resource, ci)) return resource;
  const filtered = FILTER.exec(claim.text)?.[1]?.replace(/[.!?:]+$/, '');
  if (filtered !== undefined && !wholeRepo(filtered, ci)) return filtered;
  return claim.text
    .split(/[\s`'"(),;:]+/)
    .map((token) => token.replace(/[.!?]+$/, ''))
    .find((token) => !token.includes('://') && narrower(token) && !wholeRepo(token, ci));
}
