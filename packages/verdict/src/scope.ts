import type { Event } from '@debrief/schema';

import { str } from './select.js';
import type { ClaimRecord } from './types.js';

const repoOf = (event: Event): string | undefined => str(event.attrs, 'github.repo');
const branchOf = (event: Event): string | undefined =>
  str(event.attrs, 'vcs.ref')?.replace(/^refs\/heads\//, '');

export const reposOf = (events: readonly Event[]): string =>
  [...new Set(events.map(repoOf).filter((repo) => repo !== undefined))].join(', ') ||
  'the repository';

const WHOLE = new Set([
  '',
  'all',
  'everything',
  'ci',
  'actions',
  'github actions',
  'test',
  'tests',
  'all tests',
  'suite',
  'test suite',
  'build',
  'pipeline',
  'repo',
  'repository',
  'monorepo',
  'project',
  'codebase',
  'head',
  'origin',
]);
const BRANCHES = new Set(['main', 'master', 'develop', 'trunk']);
const REF =
  /^(?:#?\d+|[0-9a-f]{7,40}|pull\/\d+|refs\/pull\/\d+\/(?:merge|head)|.*\/actions\/runs\/\d+.*)$/;

const clean = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/, '')
    .replace(/^[a-z][a-z+.-]*:\/\/[^/]+\//, '')
    .replace(/^(?:www\.)?github\.com\//, '')
    .replace(/^(?:(?:the|branch|commit|pr|pull request|workflow|repo|repository)\s+)+/, '')
    .replace(/\s+(?:workflow|pipeline|suite|repo|repository|branch)$/, '')
    .replace(/^refs\/heads\//, '')
    .replace(/#\d+$/, '');

// Why the CI evidence does not answer for this name, or undefined when it covers the whole repository.
function narrower(raw: string, ci: readonly Event[]): string | undefined {
  const name = clean(raw);
  if (WHOLE.has(name) || REF.test(name) || /^\.github\/|\.ya?ml$/.test(name)) return undefined;
  const dashed = name.replace(/[\s_]+/g, '-');
  const branches = new Set(ci.map(branchOf).filter((b) => b !== undefined));
  const covers = ci.some((event) => {
    const repo = repoOf(event)?.toLowerCase();
    return (
      repo !== undefined &&
      (name === repo ||
        name.startsWith(`${repo}/`) ||
        repo.split('/').at(-1) === dashed ||
        branchOf(event)?.toLowerCase() === name ||
        str(event.attrs, 'github.workflow')?.toLowerCase() === name)
    );
  });
  if (covers) return undefined;
  if (BRANCHES.has(name) && branches.size > 0) {
    return `CI ran on ${[...branches].join(', ')}, not ${name}`;
  }
  return `evidence covers the whole of ${reposOf(ci)}, not ${raw.trim().replace(/[.!?,;:]+$/, '')}`;
}

const STOP = new Set([
  'the',
  'a',
  'an',
  'all',
  'every',
  'each',
  'this',
  'that',
  'my',
  'our',
  'new',
  'updated',
  'whole',
  'entire',
  'full',
  'other',
  'another',
  'npm',
  'unit',
  'e2e',
  'test',
  'ci',
]);
const FLAG =
  /(?:^|[\s(`'"])(?:--(?:filter|scope|workspace|project|dir|prefix|cwd)[= ]\s*|-[FwC]\s*)['"{]*([^\s'"`,;)}]+)/g;
const SCOPED = [
  /\byarn workspace\s+([^\s`]+)/gi,
  /\bnx\s+(?:(?:test|lint|build|e2e|typecheck)\s+([\w@./-]+)|run\s+([\w@./-]+):)/gi,
  /\bcd\s+([^\s&;`]+)\s*&&/gi,
  /(?:^|\s)(?:-t|-k|--grep|--testNamePattern)[= ]\s*['"]([^'"]+)['"]/gi,
  /\btests?\s+(?:in|under|for|from)\s+[`'"]?([@\w.][\w@./*-]*\/[\w@./*-]*|@[\w.-]+\/[\w.*-]+)/gi,
  /(?:^|[\s(`'"])[`'"]?([@\w][\w@./*-]*)[`'"]?\s+(?:package|packages|spec|specs)\b/gi,
  /(?:^|[\s(`'"])([\w./-]+\.(?:test|spec)\.[cm]?[jt]sx?|[\w./-]+_test\.(?:go|py)|test_\w+\.py)\b/gi,
];

function* named(claim: ClaimRecord): Generator<string> {
  for (const key of ['scope', 'package', 'path'] as const) {
    const value = claim.params[key];
    if (typeof value === 'string') yield value;
  }
  if (claim.subject.resource !== undefined) yield claim.subject.resource;
  for (const pattern of [FLAG, ...SCOPED]) {
    for (const match of claim.text.matchAll(pattern)) {
      // Only one alternative's group is set per match; the others are undefined at runtime.
      const groups: (string | undefined)[] = match.slice(1);
      const name = groups.find((group) => group !== undefined);
      if (name !== undefined && !STOP.has(name.toLowerCase())) yield name;
    }
  }
}

// Why repo-wide CI evidence cannot settle this claim: it names a package, path, file, branch or test filter (P-64.1).
export function scopeMismatch(claim: ClaimRecord, ci: readonly Event[]): string | undefined {
  for (const name of named(claim)) {
    const why = narrower(name, ci);
    if (why !== undefined) return why;
  }
  return undefined;
}

const GENERIC_JOBS = new Set([
  'ci',
  'run',
  'runs',
  'workflow',
  'workflow_run',
  'pipeline',
  'check',
  'checks',
  'build',
  'test',
  'tests',
]);
const JOB = /(?:^|[\s(`'"])[`'"]?([\w:./-]+)[`'"]?\s+(?:job|check|step)\b/i;

// A job or check the claim names: CI's run-level record does not say how one job went.
export function jobOf(claim: ClaimRecord): string | undefined {
  const named = claim.params.job;
  if (typeof named === 'string') return named;
  const operation = claim.subject.operation?.toLowerCase();
  if (operation !== undefined && !GENERIC_JOBS.has(operation)) return operation;
  const said = JOB.exec(claim.text)?.[1];
  return said === undefined || STOP.has(said.toLowerCase()) || GENERIC_JOBS.has(said.toLowerCase())
    ? undefined
    : said;
}
