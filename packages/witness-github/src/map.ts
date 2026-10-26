import { redactSecrets } from '@debrief/schema';

import { type TestCounts } from './junit.js';
import {
  type CheckRun,
  type Job,
  type PullRequest,
  type RestDeleteEvent,
  type RestPushEvent,
  type User,
  type WorkflowRun,
} from './payloads.js';

export type GithubAttrs = Record<string, string | number | boolean>;

export interface GithubWireEvent {
  source: 'world-hook';
  provenance: 'observed';
  kind: 'world.change';
  sourceId: string;
  sourceTs: string;
  runId: string;
  actor: { type: 'human' | 'system'; id: string };
  target: {
    system: 'github';
    resource: string;
    environment: 'unknown';
    operation: string;
  };
  attrs: GithubAttrs;
  summary: string;
}

export interface JobCounts {
  passed: number;
  failed: number;
  skipped: number;
  cancelled: number;
  other: number;
  total: number;
}

const ZERO_SHA = /^0+$/;
const SHORT = 7;

const clean = (text: string): string => redactSecrets(text).text;
const iso = (value: string | number): string =>
  new Date(typeof value === 'number' ? value * 1000 : value).toISOString();
const short = (sha: string): string => sha.slice(0, SHORT);

export const runIdFor = (sourceTs: string): string => `witness:github:${sourceTs.slice(0, 10)}`;

function personActor(user: User): GithubWireEvent['actor'] {
  return { type: user.type === 'Bot' ? 'system' : 'human', id: user.login };
}

const systemActor = (id: string): GithubWireEvent['actor'] => ({ type: 'system', id });

function summarize(text: string): string {
  return clean(text).slice(0, 280);
}

function event(
  fields: Pick<GithubWireEvent, 'sourceId' | 'actor' | 'attrs'> & {
    sourceTs: string;
    resource: string;
    operation: string;
    summary: string;
  },
): GithubWireEvent {
  const sourceTs = iso(fields.sourceTs);
  return {
    source: 'world-hook',
    provenance: 'observed',
    kind: 'world.change',
    sourceId: fields.sourceId,
    sourceTs,
    runId: runIdFor(sourceTs),
    actor: fields.actor,
    target: {
      system: 'github',
      resource: fields.resource,
      environment: 'unknown',
      operation: fields.operation,
    },
    attrs: { ...fields.attrs, 'witness.trust': 'third-party' },
    summary: summarize(fields.summary),
  };
}

const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);

// A job that is unfinished or has an unfamiliar conclusion is `other`, never a failure.
export function countJobs(jobs: readonly Job[]): JobCounts {
  const counts: JobCounts = {
    passed: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
    other: 0,
    total: jobs.length,
  };
  for (const { conclusion } of jobs) {
    if (conclusion === 'success') counts.passed += 1;
    else if (conclusion === 'skipped' || conclusion === 'neutral') counts.skipped += 1;
    else if (conclusion === 'cancelled') counts.cancelled += 1;
    else if (conclusion !== null && FAILED.has(conclusion)) counts.failed += 1;
    else counts.other += 1;
  }
  return counts;
}

export interface PushFacts {
  repo: string;
  ref: string;
  before: string;
  after: string;
  actor: User;
  at: string | number;
}

export function mapPush(facts: PushFacts): GithubWireEvent[] {
  if (ZERO_SHA.test(facts.after)) return [];
  const created = ZERO_SHA.test(facts.before);
  const tag = facts.ref.startsWith('refs/tags/');
  const operation = `${created ? 'create' : 'push'}.${tag ? 'tag' : 'branch'}`;
  const attrs: GithubAttrs = {
    'github.event': 'push',
    'github.repo': facts.repo,
    'github.actor': facts.actor.login,
    'vcs.ref': clean(facts.ref),
    'commit.sha': facts.after,
  };
  if (!created) attrs['commit.before'] = facts.before;
  return [
    event({
      sourceId: `github:push:${facts.repo}:${facts.ref}:${facts.after}`,
      sourceTs: iso(facts.at),
      actor: personActor(facts.actor),
      resource: `${facts.repo}@${clean(facts.ref)}`,
      operation,
      attrs,
      summary: `${facts.actor.login} ${created ? 'created' : 'pushed'} ${short(facts.after)} on ${facts.repo}@${facts.ref}`,
    }),
  ];
}

export interface DeleteFacts {
  repo: string;
  ref: string;
  refType: 'branch' | 'tag';
  actor: User;
  at: string;
}

// The webhook carries no timestamp, so a ref deleted twice in a lifetime dedupes to one event.
export function mapDelete(facts: DeleteFacts): GithubWireEvent[] {
  const prefix = facts.refType === 'tag' ? 'refs/tags/' : 'refs/heads/';
  return [
    event({
      sourceId: `github:delete:${facts.repo}:${facts.refType}:${facts.ref}`,
      sourceTs: facts.at,
      actor: personActor(facts.actor),
      resource: `${facts.repo}@${clean(prefix + facts.ref)}`,
      operation: `delete.${facts.refType}`,
      attrs: {
        'github.event': 'delete',
        'github.repo': facts.repo,
        'github.actor': facts.actor.login,
        'vcs.ref': clean(prefix + facts.ref),
      },
      summary: `${facts.actor.login} deleted ${facts.refType} ${facts.ref} on ${facts.repo}`,
    }),
  ];
}

export const mapRestPush = (repo: string, rest: RestPushEvent): GithubWireEvent[] =>
  mapPush({
    repo,
    ref: rest.payload.ref,
    before: rest.payload.before,
    after: rest.payload.head,
    actor: rest.actor,
    at: rest.created_at,
  });

export const mapRestDelete = (repo: string, rest: RestDeleteEvent): GithubWireEvent[] =>
  mapDelete({
    repo,
    ref: rest.payload.ref,
    refType: rest.payload.ref_type,
    actor: rest.actor,
    at: rest.created_at,
  });

export type PullRequestTransition = 'opened' | 'reopened' | 'merged' | 'closed';

export function mapPullRequest(
  repo: string,
  pr: PullRequest,
  transition: PullRequestTransition,
): GithubWireEvent[] {
  const merged = transition === 'merged';
  const at =
    transition === 'opened'
      ? pr.created_at
      : transition === 'reopened'
        ? pr.updated_at
        : ((merged ? pr.merged_at : pr.closed_at) ?? pr.updated_at);
  const mergedBy = merged ? pr.merged_by : undefined;
  const person = transition === 'opened' ? pr.user : (mergedBy ?? undefined);
  const actor = person === undefined ? systemActor('github') : personActor(person);
  const attrs: GithubAttrs = {
    'github.event': 'pull_request',
    'github.repo': repo,
    'github.pr.number': pr.number,
    'github.pr.author': pr.user.login,
    'vcs.head_ref': clean(pr.head.ref),
    'vcs.base_ref': clean(pr.base.ref),
    'commit.sha': pr.head.sha,
  };
  if (person !== undefined) attrs['github.actor'] = person.login;
  if (merged && pr.merge_commit_sha) attrs['commit.merge_sha'] = pr.merge_commit_sha;
  const verb = merged ? 'merged' : transition;
  return [
    event({
      sourceId: `github:pull_request:${repo}:${String(pr.number)}:${transition}:${iso(at)}`,
      sourceTs: at,
      actor,
      resource: `${repo}#${String(pr.number)}`,
      operation: `pull_request.${transition}`,
      attrs,
      summary: `${actor.id} ${verb} pull request #${String(pr.number)} "${pr.title}" on ${repo} (${pr.head.ref} into ${pr.base.ref})`,
    }),
  ];
}

// What a poller can see of a pull request's life: it opened, and maybe it ended.
export function mapPullRequestState(repo: string, pr: PullRequest): GithubWireEvent[] {
  const ended: PullRequestTransition | undefined = pr.merged_at
    ? 'merged'
    : pr.state === 'closed'
      ? 'closed'
      : undefined;
  return [
    ...mapPullRequest(repo, pr, 'opened'),
    ...(ended === undefined ? [] : mapPullRequest(repo, pr, ended)),
  ];
}

const runPerson = (run: WorkflowRun): User | undefined =>
  run.triggering_actor ?? run.actor ?? undefined;

function runAttrs(repo: string, run: WorkflowRun, conclusion: string): GithubAttrs {
  const person = runPerson(run);
  const attrs: GithubAttrs = {
    'github.event': 'workflow_run',
    'github.repo': repo,
    'github.run_id': run.id,
    'github.run_attempt': run.run_attempt,
    'ci.conclusion': conclusion,
    'commit.sha': run.head_sha,
  };
  if (run.name) attrs['github.workflow'] = clean(run.name);
  if (run.head_branch) attrs['vcs.ref'] = clean(`refs/heads/${run.head_branch}`);
  if (run.event) attrs['github.trigger'] = run.event;
  if (person !== undefined) attrs['github.actor'] = person.login;
  return attrs;
}

export function mapWorkflowRun(
  repo: string,
  run: WorkflowRun,
  jobs?: readonly Job[],
): GithubWireEvent[] {
  if (run.status !== 'completed' || run.conclusion === null) return [];
  const person = runPerson(run);
  const attrs = runAttrs(repo, run, run.conclusion);
  let countsText = 'job counts unavailable';
  if (jobs !== undefined) {
    const counts = countJobs(jobs);
    attrs['ci.counts.of'] = 'jobs';
    attrs['ci.jobs.passed'] = counts.passed;
    attrs['ci.jobs.failed'] = counts.failed;
    attrs['ci.jobs.skipped'] = counts.skipped;
    attrs['ci.jobs.cancelled'] = counts.cancelled;
    attrs['ci.jobs.other'] = counts.other;
    attrs['ci.jobs.total'] = counts.total;
    const extra = [
      ...(counts.cancelled > 0 ? [`${String(counts.cancelled)} cancelled`] : []),
      ...(counts.other > 0 ? [`${String(counts.other)} other`] : []),
    ];
    countsText = [
      `jobs ${String(counts.passed)} passed`,
      `${String(counts.failed)} failed`,
      `${String(counts.skipped)} skipped`,
      ...extra,
    ].join(', ');
  }
  return [
    event({
      sourceId: `github:workflow_run:${repo}:${String(run.id)}:${String(run.run_attempt)}:${run.conclusion}`,
      sourceTs: run.updated_at,
      actor: person === undefined ? systemActor('github') : personActor(person),
      resource: `${repo}/actions/runs/${String(run.id)}`,
      operation: 'workflow_run.completed',
      attrs,
      summary: `workflow ${run.name ?? 'run'} #${String(run.id)} finished ${run.conclusion} on ${short(run.head_sha)} (${countsText})`,
    }),
  ];
}

export function mapCheckRun(repo: string, check: CheckRun): GithubWireEvent[] {
  if (check.status !== 'completed' || check.conclusion === null || check.completed_at === null) {
    return [];
  }
  const attrs: GithubAttrs = {
    'github.event': 'check_run',
    'github.repo': repo,
    'github.check_run_id': check.id,
    'github.check_name': clean(check.name),
    'ci.conclusion': check.conclusion,
    'commit.sha': check.head_sha,
  };
  if (check.check_suite) attrs['github.check_suite_id'] = check.check_suite.id;
  if (check.app) attrs['github.app'] = check.app.slug;
  return [
    event({
      sourceId: `github:check_run:${repo}:${String(check.id)}:${check.conclusion}`,
      sourceTs: check.completed_at,
      actor: systemActor(check.app?.slug ?? 'github'),
      resource: `${repo}/check-runs/${String(check.id)}`,
      operation: 'check_run.completed',
      attrs,
      summary: `check ${check.name} finished ${check.conclusion} on ${short(check.head_sha)}`,
    }),
  ];
}

export type TestSource = 'junit' | 'check-run';

// Its own event, because the run event's sourceId ignores attrs and a late report could not join it.
export function mapWorkflowRunTests(
  repo: string,
  run: WorkflowRun,
  tests: { counts: TestCounts; source: TestSource },
): GithubWireEvent[] {
  if (run.status !== 'completed' || run.conclusion === null) return [];
  const { passed, failed, skipped } = tests.counts;
  const person = runPerson(run);
  const attrs = runAttrs(repo, run, run.conclusion);
  if (run.path) attrs['github.workflow_path'] = clean(run.path);
  attrs['ci.tests.source'] = tests.source;
  attrs['world.tests.passed'] = passed;
  attrs['world.tests.failed'] = failed;
  attrs['world.tests.skipped'] = skipped;
  return [
    event({
      sourceId: `github:workflow_run_tests:${repo}:${String(run.id)}:${String(run.run_attempt)}:${String(passed)}.${String(failed)}.${String(skipped)}`,
      sourceTs: run.updated_at,
      actor: person === undefined ? systemActor('github') : personActor(person),
      resource: `${repo}/actions/runs/${String(run.id)}`,
      operation: 'workflow_run.tests',
      attrs,
      summary: `workflow ${run.name ?? 'run'} #${String(run.id)} tests: ${String(passed)} passed, ${String(failed)} failed, ${String(skipped)} skipped (${tests.source}) on ${short(run.head_sha)}`,
    }),
  ];
}
