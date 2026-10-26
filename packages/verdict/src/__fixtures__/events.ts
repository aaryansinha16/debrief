import type { Attrs, Event, Target } from '@debrief/schema';

import type { Window } from '../types.js';

const HEX0 = '0'.repeat(64);

export const ulid = (n: number): string => `01JBV${String(n).padStart(21, '0')}`;

export interface Spec {
  n: number;
  at: string;
  kind: Event['kind'];
  provenance: Event['provenance'];
  source?: Event['source'];
  runId?: string;
  actor?: Event['actor'];
  target?: Target;
  attrs?: Attrs;
  summary?: string;
}

// A fixture event: the chain fields are stand-ins, the verdict package never verifies them.
export function ev(spec: Spec): Event {
  return {
    id: ulid(spec.n),
    tenantId: 'tenant-fixture',
    seq: spec.n,
    ts: spec.at,
    sourceTs: spec.at,
    source: spec.source ?? (spec.provenance === 'derived' ? 'api' : 'world-hook'),
    provenance: spec.provenance,
    runId: spec.runId ?? 'session-fixture',
    kind: spec.kind,
    actor: spec.actor ?? { type: 'system', id: 'fixture' },
    ...(spec.target === undefined ? {} : { target: spec.target }),
    attrs: spec.attrs ?? {},
    ...(spec.summary === undefined ? {} : { summary: spec.summary }),
    prevHash: HEX0,
    hash: HEX0,
  };
}

export interface ClaimSpec {
  n: number;
  at: string;
  text: string;
  predicate: string;
  subject: Target;
  params?: Record<string, string | number>;
  modality?: 'asserted' | 'hedged';
  messageId?: string;
}

export function claim(spec: ClaimSpec): Event {
  const attrs: Attrs = {
    'claim.text': spec.text,
    'claim.span.message_id': spec.messageId ?? `m${String(spec.n)}`,
    'claim.span.start': 0,
    'claim.span.end': spec.text.length,
    'claim.modality': spec.modality ?? 'asserted',
    'claim.predicate': spec.predicate,
  };
  for (const [name, value] of Object.entries(spec.params ?? {})) {
    attrs[`claim.param.${name}`] = value;
  }
  return ev({
    n: spec.n,
    at: spec.at,
    kind: 'claim',
    provenance: 'derived',
    actor: { type: 'system', id: 'debrief-claims' },
    target: spec.subject,
    attrs,
    summary: `claim ${spec.predicate} (${spec.modality ?? 'asserted'})`,
  });
}

export interface WitnessSpec {
  n: number;
  at: string;
  kind?: 'world.change' | 'world.read';
  trust?: 'local' | 'third-party' | 'none';
  target: Target;
  attrs?: Attrs;
  summary: string;
  actor?: Event['actor'];
  runId?: string;
}

export function witness(spec: WitnessSpec): Event {
  const trust = spec.trust ?? 'third-party';
  return ev({
    n: spec.n,
    at: spec.at,
    kind: spec.kind ?? 'world.change',
    provenance: 'observed',
    runId: spec.runId ?? `witness:${spec.target.system}:${spec.at.slice(0, 10)}`,
    actor: spec.actor ?? { type: 'system', id: `${spec.target.system}-witness` },
    target: spec.target,
    attrs: { ...(trust === 'none' ? {} : { 'witness.trust': trust }), ...spec.attrs },
    summary: spec.summary,
  });
}

export const SHA_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
export const SHA_B = 'b7d4e90a1c2f3856a9e0d4c7b1f28a3e5d6c9f14';
export const SHA_HUMAN = 'c0ffee5d1a2b3c4e5f60718293a4b5c6d7e8f901';

const diffstat = (lines: readonly [number | '-' | '?', number | '-' | '?', string][]): string =>
  lines.map(([a, r, p]) => `${String(a)}\t${String(r)}\t${p}`).join('\n');

export function gitState(
  n: number,
  at: string,
  sha: string,
  files: readonly [number | '-' | '?', number | '-' | '?', string][],
  branch = 'fix/invoices',
): Event {
  const added = files.reduce((s, [a]) => s + (typeof a === 'number' ? a : 0), 0);
  const removed = files.reduce((s, [, r]) => s + (typeof r === 'number' ? r : 0), 0);
  return witness({
    n,
    at,
    trust: 'local',
    actor: { type: 'system', id: 'debrief-git-witness' },
    runId: 'session-fixture',
    target: { system: 'git', resource: 'billing-api', environment: 'dev', operation: 'git.state' },
    attrs: {
      'git.repo': 'billing-api',
      'git.files': files.length,
      'git.untracked': files.filter(([a]) => a === '?').length,
      'git.lines.added': added,
      'git.lines.removed': removed,
      'commit.sha': sha,
      'vcs.ref': `refs/heads/${branch}`,
      ...(files.length === 0 ? {} : { 'git.diffstat': diffstat(files) }),
    },
    summary: `billing-api at ${sha.slice(0, 7)} on ${branch}: ${String(files.length)} files changed (+${String(added)} −${String(removed)})`,
  });
}

export interface RunSpec {
  n: number;
  at: string;
  sha: string;
  runId: number;
  attempt?: number;
  conclusion?: string;
  jobs?: Partial<Record<'passed' | 'failed' | 'skipped' | 'cancelled' | 'other', number>>;
  workflow?: string;
  workflowPath?: string;
}

export function workflowRun(spec: RunSpec): Event {
  const jobs = { passed: 3, failed: 0, skipped: 0, cancelled: 0, other: 0, ...spec.jobs };
  const total = Object.values(jobs).reduce((a, b) => a + b, 0);
  const conclusion = spec.conclusion ?? 'success';
  return witness({
    n: spec.n,
    at: spec.at,
    actor: { type: 'human', id: 'alice-dev' },
    target: {
      system: 'github',
      resource: `acme-demo/billing-api/actions/runs/${String(spec.runId)}`,
      environment: 'unknown',
      operation: 'workflow_run.completed',
    },
    attrs: {
      'github.event': 'workflow_run',
      'github.repo': 'acme-demo/billing-api',
      'github.run_id': spec.runId,
      'github.run_attempt': spec.attempt ?? 1,
      'ci.conclusion': conclusion,
      'commit.sha': spec.sha,
      'github.workflow': spec.workflow ?? 'ci',
      'github.workflow_path': spec.workflowPath ?? '.github/workflows/ci.yml',
      'vcs.ref': 'refs/heads/fix/invoices',
      'ci.counts.of': 'jobs',
      'ci.jobs.passed': jobs.passed,
      'ci.jobs.failed': jobs.failed,
      'ci.jobs.skipped': jobs.skipped,
      'ci.jobs.cancelled': jobs.cancelled,
      'ci.jobs.other': jobs.other,
      'ci.jobs.total': total,
    },
    summary: `workflow ${spec.workflow ?? 'ci'} #${String(spec.runId)} concluded ${conclusion} on ${spec.sha.slice(0, 7)}: ${String(jobs.passed)}/${String(total)} jobs passed`,
  });
}

export interface TestsSpec extends RunSpec {
  passed: number;
  failed?: number;
  skipped?: number;
  source?: string;
}

export function testReport(spec: TestsSpec): Event {
  const failed = spec.failed ?? 0;
  const skipped = spec.skipped ?? 0;
  const conclusion = spec.conclusion ?? 'success';
  return witness({
    n: spec.n,
    at: spec.at,
    actor: { type: 'human', id: 'alice-dev' },
    target: {
      system: 'github',
      resource: `acme-demo/billing-api/actions/runs/${String(spec.runId)}`,
      environment: 'unknown',
      operation: 'workflow_run.tests',
    },
    attrs: {
      'github.event': 'workflow_run',
      'github.repo': 'acme-demo/billing-api',
      'github.run_id': spec.runId,
      'github.run_attempt': spec.attempt ?? 1,
      'ci.conclusion': conclusion,
      'commit.sha': spec.sha,
      'github.workflow': spec.workflow ?? 'ci',
      'github.workflow_path': spec.workflowPath ?? '.github/workflows/ci.yml',
      'ci.tests.source': spec.source ?? 'junit',
      'world.tests.passed': spec.passed,
      'world.tests.failed': failed,
      'world.tests.skipped': skipped,
    },
    summary: `workflow ${spec.workflow ?? 'ci'} #${String(spec.runId)} tests: ${String(spec.passed)} passed, ${String(failed)} failed, ${String(skipped)} skipped (${spec.source ?? 'junit'}) on ${spec.sha.slice(0, 7)}`,
  });
}

export function prOpened(n: number, at: string, number: number, sha: string): Event {
  return witness({
    n,
    at,
    actor: { type: 'human', id: 'alice-dev' },
    target: {
      system: 'github',
      resource: `acme-demo/billing-api#${String(number)}`,
      environment: 'unknown',
      operation: 'pull_request.opened',
    },
    attrs: {
      'github.event': 'pull_request',
      'github.repo': 'acme-demo/billing-api',
      'github.pr.number': number,
      'github.pr.author': 'alice-dev',
      'vcs.head_ref': 'fix/invoices',
      'vcs.base_ref': 'main',
      'commit.sha': sha,
    },
    summary: `alice-dev opened pull request #${String(number)} "Fix invoice rounding" on acme-demo/billing-api (fix/invoices into main)`,
  });
}

export function push(
  n: number,
  at: string,
  sha: string,
  branch: string,
  actor = 'alice-dev',
): Event {
  return witness({
    n,
    at,
    actor: { type: 'human', id: actor },
    target: {
      system: 'github',
      resource: `acme-demo/billing-api@refs/heads/${branch}`,
      environment: 'unknown',
      operation: 'push.branch',
    },
    attrs: {
      'github.event': 'push',
      'github.repo': 'acme-demo/billing-api',
      'github.actor': actor,
      'vcs.ref': `refs/heads/${branch}`,
      'commit.sha': sha,
    },
    summary: `${actor} pushed ${sha.slice(0, 7)} on acme-demo/billing-api@refs/heads/${branch}`,
  });
}

export const WINDOW: Window = { from: '2026-10-25T08:40:00.000Z', to: '2026-10-25T09:10:00.000Z' };

export const ist = (time: string): string => `2026-10-25T${time}.000+05:30`;
