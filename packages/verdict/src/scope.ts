import type { Event } from '@debrief/schema';

import { num, op, short, str } from './select.js';
import type { ClaimRecord } from './types.js';

const repoOf = (event: Event): string | undefined => str(event.attrs, 'github.repo');
const branchOf = (event: Event): string | undefined =>
  str(event.attrs, 'vcs.ref')?.replace(/^refs\/heads\//, '');
const unique = (values: readonly (string | undefined)[]): string[] => [
  ...new Set(values.filter((v): v is string => v !== undefined && v !== '')),
];

export const reposOf = (events: readonly Event[]): string =>
  unique(events.map(repoOf)).join(', ') || 'the repository';

const WHOLE = new Set([
  '',
  'all',
  'everything',
  'ci',
  'checks',
  'all checks',
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
  'whole',
  'whole repo',
  'repository',
  'monorepo',
  'project',
  'codebase',
  'all packages',
  'head',
  'origin',
]);
const MAIN_BRANCHES = new Set(['main', 'master', 'develop', 'trunk']);

const clean = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/, '')
    .replace(/^[a-z][a-z+.-]*:\/\/[^/]+\//, '')
    .replace(/^(?:www\.)?github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/^(?:(?:the|branch|commit|sha|pr|pull request|workflow|repo|repository)\s+)+/, '')
    .replace(/\s+(?:workflow|pipeline|suite|repo|repository|branch)$/, '')
    .replace(/^(?:refs\/heads\/|origin\/)/, '');

interface Evidence {
  ci: readonly Event[];
  observed: readonly Event[];
}

// A commit, run or PR answers for the evidence only when it is the one CI ran: '' when bound, else why not.
function refCheck(name: string, { ci, observed }: Evidence): string | undefined {
  const shas = unique(ci.map((e) => str(e.attrs, 'commit.sha')));
  const runs = unique(ci.map((e) => num(e.attrs, 'github.run_id')?.toString()));
  const run = /(?:^|\/)actions\/runs\/(\d+)|^run #?(\d+)$/.exec(name);
  if (run !== null) {
    const id = String(run[1] ?? run[2]);
    return runs.includes(id) ? '' : `evidence covers run #${runs.join(', #')}, not run #${id}`;
  }
  const pr = /^(?:#|pull\/|refs\/pull\/)?(\d+)(?:\/(?:merge|head))?$/.exec(name);
  if (pr !== null) {
    const number = Number(pr[1]);
    const bound = observed.some(
      (e) =>
        op(e).startsWith('pull_request') &&
        num(e.attrs, 'github.pr.number') === number &&
        shas.includes(String(str(e.attrs, 'commit.sha'))),
    );
    return bound ? '' : `no witness ties PR #${String(number)} to the commit CI ran`;
  }
  const sha = /^(?:commit\/)?([0-9a-f]{7,40})$/.exec(name);
  if (sha !== null) {
    const want = String(sha[1]);
    return shas.some((s) => s.startsWith(want))
      ? ''
      : `CI ran on ${shas.map(short).join(', ')}, not ${want}`;
  }
  return undefined;
}

// Why the CI evidence does not answer for this name, or undefined when it covers the whole repository.
function narrower(raw: string, evidence: Evidence): string | undefined {
  const { ci } = evidence;
  let name = clean(raw);
  if (WHOLE.has(name)) return undefined;
  const repos = unique(ci.map(repoOf)).map((r) => r.toLowerCase());
  const branches = unique(ci.map(branchOf)).map((b) => b.toLowerCase());
  const at = /^([\w.-]+\/[\w.-]+)(?:@refs\/heads\/(.+)|(#\d+))$/.exec(name);
  if (at !== null && repos.includes(String(at[1]))) name = String(at[2] ?? at[3]);
  for (const repo of repos) {
    if (name === repo) return undefined;
    if (name.startsWith(`${repo}/`)) {
      const rest = name.slice(repo.length + 1);
      const tree = /^tree\/(.+)$/.exec(rest)?.[1];
      if (tree === undefined && !/^(?:pull\/\d+|commit\/[0-9a-f]+|actions\/runs\/\d+)/.test(rest)) {
        return `evidence covers the whole of ${reposOf(ci)}, not ${raw.trim()}`;
      }
      name = tree ?? rest;
    }
  }
  const ref = refCheck(name, evidence);
  if (ref !== undefined) return ref === '' ? undefined : ref;
  const workflows = ci.flatMap((e) => {
    const path = str(e.attrs, 'github.workflow_path')?.toLowerCase();
    return unique([str(e.attrs, 'github.workflow')?.toLowerCase(), path, path?.split('/').at(-1)]);
  });
  const dashed = name.replace(/[\s_]+/g, '-');
  if (
    workflows.includes(name) ||
    branches.includes(name) ||
    repos.some((repo) => repo.split('/').at(-1) === dashed)
  ) {
    return undefined;
  }
  if (MAIN_BRANCHES.has(name) && branches.length > 0) {
    return `CI ran on ${branches.join(', ')}, not ${name}`;
  }
  return `evidence covers the whole of ${reposOf(ci)}, not ${raw.trim().replace(/[.!?,;:]+$/, '')}`;
}

const STOP = new Set([
  'ci',
  'github',
  'the',
  'a',
  'an',
  'all',
  'every',
  'each',
  'any',
  'no',
  'both',
  'either',
  'these',
  'those',
  'this',
  'that',
  'its',
  'their',
  'my',
  'our',
  'new',
  'updated',
  'whole',
  'entire',
  'full',
  'other',
  'another',
  'several',
  'many',
  'some',
  'required',
  'status',
  'npm',
  'one',
  'two',
  'three',
  'four',
  'five',
]);
// A path names a letter somewhere: "640/640" is a ratio.
const PATHISH = String.raw`(?=[\w@.*\/-]*[a-z])[@\w.][\w@.*\/-]*\/[\w@.*\/-]*`;
const PATTERNS = [
  /(?:^|[\s(`'"])(?:--(?:filter|scope|workspace|project|dir|prefix|cwd)[= ]\s*|-[FC]\s*)['"{]*([^\s'"`,;)}]+)/g,
  /\byarn workspace\s+([^\s`]+)/gi,
  /\bnx\s+(?:(?:test|lint|build|e2e|typecheck)\s+([\w@./-]+)|run\s+([\w@./-]+):)/gi,
  /\bcd\s+([^\s&;`]+)\s*&&/gi,
  /(?:^|\s)(?:-t|-k|--grep|--testNamePattern)[= ]\s*['"]([^'"]+)['"]/gi,
  new RegExp(
    String.raw`\btests?\s+(?:in|under|for|from)\s+[\x60'"]?(${PATHISH}|@[\w.-]+\/[\w.*-]+)`,
    'gi',
  ),
  new RegExp(
    String.raw`\b(?:pass(?:es|ed|ing)?|green|ran|run)\s+(?:in|under|for)\s+[\x60'"]?(${PATHISH})`,
    'gi',
  ),
  new RegExp(String.raw`(?:^|[\s(\x60'"])(${PATHISH})[\x60'"]?\s+(?:tests?|specs?|suite)\b`, 'gi'),
  /(?:^|[\s(`'",])(@[\w.-]+\/[\w.*-]+)/g,
  /(?:^|[\s(`'",])((?:apps|packages|libs|services|modules|crates|internal)\/[\w@.*-]+)/g,
  /(?:^|[\s(`'"])[`'"]?([@\w][\w@./*-]*)[`'"]?\s+(?:package|packages|spec|specs|module|directory|folder|workspace)\b/gi,
  /(?:^|[\s(`'"])([\w./*-]+\.(?:test|spec)\.[cm]?[jt]sx?|[\w./-]+_test\.(?:go|py)|test_\w+\.py)\b/gi,
  /\bon (main|master|develop|trunk)\b/gi,
];

function* named(claim: ClaimRecord): Generator<string> {
  for (const key of ['scope', 'package', 'path'] as const) {
    const value = claim.params[key];
    if (typeof value === 'string') yield value;
  }
  if (claim.subject.resource !== undefined) yield claim.subject.resource;
  for (const pattern of PATTERNS) {
    for (const match of claim.text.matchAll(pattern)) {
      // Only one alternative's group is set per match; the others are undefined at runtime.
      const groups: (string | undefined)[] = match.slice(1);
      const name = groups.find((group) => group !== undefined);
      if (name !== undefined && !STOP.has(name.toLowerCase())) yield name;
    }
  }
}

// Why repo-wide CI evidence cannot settle this claim: it names a package, path, file, branch, ref or job (P-64.1).
export function scopeMismatch(
  claim: ClaimRecord,
  ci: readonly Event[],
  observed: readonly Event[] = ci,
): string | undefined {
  for (const name of named(claim)) {
    const why = narrower(name, { ci, observed });
    if (why !== undefined) return why;
  }
  const job = jobOf(claim);
  return job === undefined
    ? undefined
    : `evidence covers whole runs of ${reposOf(ci)}, not the ${job} job`;
}

const GENERIC_OPERATIONS = new Set([
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
  'status',
  'completed',
  'conclusion',
  'result',
  'results',
  'passed',
  'success',
  'green',
]);
const JOB = /(?:^|[\s(`'"])[`'"]?([\w:./-]+)[`'"]?\s+(?:job|check|step)s?\b/i;
const CHECK_WORD =
  /\b(lint(?:ing)?|type-?check(?:ing)?|format(?:ting)?|prettier|eslint|e2e|unit tests?|integration tests?|coverage|perf(?:-smoke)?|smoke tests?|audit)\b/i;
const RUN_LEVEL =
  /\bCI (?:is|was|went|stays) green\b|\ball (?:checks|jobs)\b|\bevery (?:check|job)\b|\bthe (?:whole|entire) (?:run|workflow|pipeline)\b/i;

// A job or check the claim names: CI's run-level record does not say how one job went.
export function jobOf(claim: ClaimRecord): string | undefined {
  const named = claim.params.job;
  if (typeof named === 'string') return named;
  const operation = claim.subject.operation?.toLowerCase();
  if (operation !== undefined && !GENERIC_OPERATIONS.has(operation)) return operation;
  const said = JOB.exec(claim.text)?.[1];
  if (said !== undefined && !STOP.has(said.toLowerCase())) return said;
  const runLevel = typeof claim.params.workflow === 'string' || RUN_LEVEL.test(claim.text);
  if (claim.predicate !== 'ci.passed' || runLevel) return undefined;
  return CHECK_WORD.exec(claim.text)?.[1];
}
