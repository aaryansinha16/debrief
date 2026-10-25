import {
  checkRunSchema,
  type RestDeleteEvent,
  type RestPushEvent,
  jobsResponseSchema,
  pullRequestSchema,
  restDeleteEventSchema,
  restPushEventSchema,
  workflowRunSchema,
} from '@debrief/witness-github';
import {
  DELETE_RECEIVED_AT,
  deliveries,
  FIXTURE_REPO,
  jobsByRun,
  rest,
} from '@debrief/witness-github/fixtures';

import type { GithubClient } from './github-api.js';
import { collectRepo, newPollState, pollOnce, type PollOutcome } from './poller.js';
import { handleDelivery } from './receiver.js';
import type { IngestResult, Sink } from './sink.js';
import { sign } from './signature.js';

const REPLAY_SECRET = 'replay-only-secret';

export function fixtureClient(): GithubClient {
  return {
    repoEvents: () => {
      const found: (RestPushEvent | RestDeleteEvent)[] = [];
      for (const item of rest.events) {
        const push = restPushEventSchema.safeParse(item);
        const del = restDeleteEventSchema.safeParse(item);
        if (push.success) found.push(push.data);
        if (del.success) found.push(del.data);
      }
      return Promise.resolve(found);
    },
    pulls: () => Promise.resolve(rest.pulls.map((item) => pullRequestSchema.parse(item))),
    pull: (_repo, number) => Promise.resolve(pullRequestSchema.parse(rest.pullsByNumber[number])),
    completedRuns: () =>
      Promise.resolve(
        rest.runs
          .map((item) => workflowRunSchema.parse(item))
          .filter((run) => run.status === 'completed'),
      ),
    jobs: (_repo, runId) =>
      Promise.resolve(
        jobsResponseSchema.parse(jobsByRun[runId] ?? { total_count: 0, jobs: [] }).jobs,
      ),
    checkRuns: (_repo, sha) =>
      Promise.resolve(
        (rest.checkRunsBySha[sha]?.check_runs ?? []).map((item) => checkRunSchema.parse(item)),
      ),
  };
}

export async function replayWebhooks(sink: Sink, client?: GithubClient): Promise<IngestResult> {
  const total: IngestResult = { accepted: 0, duplicates: 0 };
  for (const delivery of deliveries) {
    const body = Buffer.from(JSON.stringify(delivery.payload));
    const result = await handleDelivery(
      {
        secret: REPLAY_SECRET,
        sink,
        now: () => new Date(DELETE_RECEIVED_AT),
        ...(client === undefined ? {} : { github: client }),
      },
      { event: delivery.event, signature: sign(REPLAY_SECRET, body), body },
    );
    if (result.status === 200) {
      const parsed = JSON.parse(result.body) as IngestResult;
      total.accepted += parsed.accepted;
      total.duplicates += parsed.duplicates;
    } else if (result.status >= 400) {
      throw new Error(`delivery ${delivery.deliveryId}: ${String(result.status)} ${result.body}`);
    }
  }
  return total;
}

export const replayPoll = (sink: Sink): Promise<PollOutcome> =>
  pollOnce(fixtureClient(), sink, [FIXTURE_REPO], newPollState());

export const collectFixturePoll = (): ReturnType<typeof collectRepo> =>
  collectRepo(fixtureClient(), FIXTURE_REPO, newPollState());
