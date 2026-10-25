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

const PER_PAGE = 50;

export interface GithubClient {
  repoEvents(repo: string): Promise<(RestPushEvent | RestDeleteEvent)[]>;
  pulls(repo: string): Promise<PullRequest[]>;
  pull(repo: string, number: number): Promise<PullRequest>;
  completedRuns(repo: string): Promise<WorkflowRun[]>;
  jobs(repo: string, runId: number): Promise<Job[]>;
  checkRuns(repo: string, sha: string): Promise<CheckRun[]>;
}

const listOf = <T>(schema: z.ZodType<T>, items: unknown): T[] =>
  z
    .array(z.unknown())
    .parse(items)
    .flatMap((item) => {
      const parsed = schema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });

// Read-only: every call is a GET. The token needs repository read access only.
export function createGithubClient(options: {
  token: string;
  apiUrl?: string;
  fetch?: typeof fetch;
}): GithubClient {
  const send = options.fetch ?? fetch;
  const base = (options.apiUrl ?? 'https://api.github.com').replace(/\/+$/, '');

  async function get(path: string): Promise<unknown> {
    const response = await send(`${base}${path}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${options.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    });
    if (!response.ok) throw new GithubApiError(response.status, path.split('?')[0] ?? path);
    return response.json();
  }

  return {
    async repoEvents(repo) {
      const items = await get(`/repos/${repo}/events?per_page=${String(PER_PAGE)}`);
      return [...listOf(restPushEventSchema, items), ...listOf(restDeleteEventSchema, items)];
    },
    async pulls(repo) {
      const path = `/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=${String(PER_PAGE)}`;
      return listOf(pullRequestSchema, await get(path));
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
      return listOf(workflowRunSchema, body.workflow_runs);
    },
    async jobs(repo, runId) {
      const path = `/repos/${repo}/actions/runs/${String(runId)}/jobs?per_page=100`;
      return jobsResponseSchema.parse(await get(path)).jobs;
    },
    async checkRuns(repo, sha) {
      const body = z
        .object({ check_runs: z.array(z.unknown()) })
        .parse(await get(`/repos/${repo}/commits/${sha}/check-runs?per_page=100`));
      return listOf(checkRunSchema, body.check_runs);
    },
  };
}
