import type { Event } from '@debrief/schema';

import { latestAttempts, num, onLatestCommit, op, short, str } from '../select.js';
import type { ClaimRecord, Context, Finding } from '../types.js';

export const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);

const TEST_CONFIG =
  /(?:^|\/)(?:(?:vitest|jest|playwright|cypress|karma|mocha)\.(?:config|workspace)\.[cm]?[jt]s|pytest\.ini|tox\.ini|phpunit\.xml|\.mocharc(?:\.[a-z]+)?)$/;

export const isRun = (event: Event): boolean => op(event) === 'workflow_run.completed';
export const isTestReport = (event: Event): boolean => op(event) === 'workflow_run.tests';
export const isCi = (event: Event): boolean => op(event).startsWith('workflow_run.');

export const runLabel = (event: Event): string => {
  const id = num(event.attrs, 'github.run_id');
  const sha = str(event.attrs, 'commit.sha') ?? '';
  return `run #${id === undefined ? '?' : String(id)} on ${short(sha)}`;
};

// An agent can author the report it is judged by: a session that edited CI or test config lowers the trust.
export function reportEdited(reports: readonly Event[], ctx: Context): string | undefined {
  const workflowPaths = new Set(
    reports.map((event) => str(event.attrs, 'github.workflow_path')).filter((p) => p !== undefined),
  );
  for (const path of ctx.editedPaths) {
    if (workflowPaths.has(path) || path.startsWith('.github/') || TEST_CONFIG.test(path)) {
      return path;
    }
  }
  return undefined;
}

export interface CiSelection {
  events: Event[];
  missing?: Finding;
}

export const NO_GIT =
  'no local git witness recorded the working copy, so nothing binds CI runs to this session (install the Claude Code hook)';

export const headStayed = (ctx: Context, what: string): Finding =>
  noWitness(
    `the session's HEAD stayed at ${short(ctx.baseCommit ?? '')}, the commit it started from; ${what}`,
  );

// CI events are picked by operation (D-085) and judged on the session's latest commit (D-089).
export function selectCi(ctx: Context, matches: (event: Event) => boolean): CiSelection {
  const ci = ctx.observed.filter(isCi);
  if (ci.length === 0) {
    return {
      events: [],
      missing: noWitness('no GitHub Actions witness recorded a workflow run in the window'),
    };
  }
  if (!ctx.witnessed) return { events: [], missing: noWitness(NO_GIT) };
  if (ctx.latestCommit === undefined) {
    return { events: [], missing: headStayed(ctx, "a run on it is not the session's work") };
  }
  const events = latestAttempts(onLatestCommit(ci.filter(matches), ctx));
  if (events.length === 0) {
    return {
      events: [],
      missing: noWitness(
        `GitHub recorded workflow runs in the window, none on this session's latest commit ${short(ctx.latestCommit)}`,
      ),
    };
  }
  return { events };
}

export const noWitness = (reason: string, evidence: readonly Event[] = []): Finding => ({
  outcome: 'no-witness',
  evidence,
  reason,
});

export function workflowOf(claim: ClaimRecord): string | undefined {
  const name = claim.params.workflow;
  return typeof name === 'string' ? name.toLowerCase() : undefined;
}

export const namedWorkflow = (event: Event, name: string | undefined): boolean =>
  name === undefined || (str(event.attrs, 'github.workflow') ?? '').toLowerCase() === name;
