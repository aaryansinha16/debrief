import {
  type CheckRun,
  checkRunSchema,
  type Job,
  jobsResponseSchema,
  type PullRequest,
  pullRequestSchema,
  type RestDeleteEvent,
  restDeleteEventSchema,
  type RestPushEvent,
  restPushEventSchema,
  type WorkflowRun,
  workflowRunSchema,
} from '@debrief/witness-github';
import { z } from 'zod';

export class GithubApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`GET ${path} failed with ${String(status)}`);
    this.name = 'GithubApiError';
  }
}

export class GithubRateLimitError extends Error {
  constructor(readonly retryAfterS: number) {
    super(`rate limited, retry in ${String(retryAfterS)}s`);
    this.name = 'GithubRateLimitError';
  }
}

export class IncompleteJobsError extends Error {
  constructor(
    readonly runId: number,
    readonly got: number,
    readonly expected: number,
  ) {
    super(`run ${String(runId)}: read ${String(got)} of ${String(expected)} jobs`);
    this.name = 'IncompleteJobsError';
  }
}

const PER_PAGE = 50;
const JOBS_PER_PAGE = 100;
const MAX_JOB_PAGES = 20;
const FALLBACK_WAIT_S = 60;
const MAX_BACKOFF_S = 900;

export interface GithubClient {
  repoEvents(repo: string): Promise<(RestPushEvent | RestDeleteEvent)[]>;
  pulls(repo: string): Promise<PullRequest[]>;
  pull(repo: string, number: number): Promise<PullRequest>;
  completedRuns(repo: string): Promise<WorkflowRun[]>;
  jobs(repo: string, runId: number, attempt: number): Promise<Job[]>;
  checkRuns(repo: string, sha: string): Promise<CheckRun[]>;
}

// Read-only: every call is a GET. The token needs repository read access only.
export function createGithubClient(options: {
  token: string;
  apiUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (message: string) => void;
}): GithubClient {
  const send = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const base = (options.apiUrl ?? 'https://api.github.com').replace(/\/+$/, '');
  let pausedUntil = 0;
  let backoffS = FALLBACK_WAIT_S;

  function listOf<T>(what: string, schema: z.ZodType<T>, items: unknown[]): T[] {
    const kept = items.flatMap((item) => {
      const parsed = schema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
    if (kept.length < items.length) {
      options.log?.(
        `${what}: skipped ${String(items.length - kept.length)} items of unexpected shape`,
      );
    }
    return kept;
  }

  async function get(path: string): Promise<unknown> {
    const wait = Math.ceil((pausedUntil - now()) / 1000);
    if (wait > 0) throw new GithubRateLimitError(wait);
    const response = await send(`${base}${path}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${options.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    });
    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    const retryAfter = Number(response.headers.get('retry-after'));
    const untilReset = reset > 0 ? Math.ceil(reset - now() / 1000) : FALLBACK_WAIT_S;
    const exhausted = remaining === '0';
    if (response.status === 429 || (response.status === 403 && (exhausted || retryAfter > 0))) {
      const seconds = Math.max(1, retryAfter > 0 ? retryAfter : untilReset);
      pausedUntil = now() + seconds * 1000;
      throw new GithubRateLimitError(seconds);
    }
    if (response.status === 403 && (await response.clone().text()).includes('rate limit')) {
      // A secondary limit names no wait; back off, doubling while it keeps firing.
      const seconds = backoffS;
      pausedUntil = now() + seconds * 1000;
      backoffS = Math.min(backoffS * 2, MAX_BACKOFF_S);
      throw new GithubRateLimitError(seconds);
    }
    if (response.ok) backoffS = FALLBACK_WAIT_S;
    if (exhausted) pausedUntil = now() + Math.max(1, untilReset) * 1000;
    if (!response.ok) throw new GithubApiError(response.status, path.split('?', 1).join());
    return response.json();
  }

  return {
    async repoEvents(repo) {
      const items = z
        .array(z.unknown())
        .parse(await get(`/repos/${repo}/events?per_page=${String(PER_PAGE)}`));
      const typed = (type: string) =>
        items.filter((item) => (item as { type?: unknown } | null)?.type === type);
      return [
        ...listOf('events', restPushEventSchema, typed('PushEvent')),
        ...listOf('events', restDeleteEventSchema, typed('DeleteEvent')),
      ];
    },
    async pulls(repo) {
      const path = `/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=${String(PER_PAGE)}`;
      return listOf('pulls', pullRequestSchema, z.array(z.unknown()).parse(await get(path)));
    },
    async pull(repo, number) {
      return pullRequestSchema.parse(await get(`/repos/${repo}/pulls/${String(number)}`));
    },
    async completedRuns(repo) {
      const body = z
        .object({ workflow_runs: z.array(z.unknown()) })
        .parse(
          await get(`/repos/${repo}/actions/runs?status=completed&per_page=${String(PER_PAGE)}`),
        );
      return listOf('runs', workflowRunSchema, body.workflow_runs);
    },
    // Every job of the attempt, or an error: truncated counts would be wrong counts.
    async jobs(repo, runId, attempt) {
      const jobs: Job[] = [];
      let expected = 0;
      for (let page = 1; page <= MAX_JOB_PAGES; page += 1) {
        const path = `/repos/${repo}/actions/runs/${String(runId)}/attempts/${String(attempt)}/jobs?per_page=${String(JOBS_PER_PAGE)}&page=${String(page)}`;
        const body = jobsResponseSchema.parse(await get(path));
        expected = body.total_count;
        jobs.push(...body.jobs);
        if (jobs.length >= expected || body.jobs.length === 0) break;
      }
      if (jobs.length !== expected) throw new IncompleteJobsError(runId, jobs.length, expected);
      return jobs;
    },
    async checkRuns(repo, sha) {
      const body = z
        .object({ total_count: z.number().optional(), check_runs: z.array(z.unknown()) })
        .parse(await get(`/repos/${repo}/commits/${sha}/check-runs?per_page=100`));
      if ((body.total_count ?? 0) > body.check_runs.length) {
        options.log?.(
          `check runs for ${sha.slice(0, 7)}: read ${String(body.check_runs.length)} of ${String(body.total_count)}`,
        );
      }
      return listOf('check runs', checkRunSchema, body.check_runs);
    },
  };
}
