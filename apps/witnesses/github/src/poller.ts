import {
  type GithubWireEvent,
  mapCheckRun,
  mapPullRequestState,
  mapRestDelete,
  mapRestPush,
  mapWorkflowRun,
} from '@debrief/witness-github';

import { GithubRateLimitError, type GithubClient } from './github-api.js';
import type { IngestResult, Sink } from './sink.js';

export interface PollState {
  runs: Set<string>;
  pulls: Set<string>;
}

export const newPollState = (): PollState => ({ runs: new Set(), pulls: new Set() });

export interface Collected {
  events: GithubWireEvent[];
  errors: string[];
  retryAfterS: number | undefined;
  commit: () => void;
}

export interface PollOutcome extends IngestResult {
  events: number;
  errors: string[];
  retryAfterS: number | undefined;
}

// Everything is derived from what GitHub lists now; sourceIds make repeating a pass harmless.
// Runs already posted are skipped before any further request, so an idle pass costs three calls.
export async function collectRepo(
  client: GithubClient,
  repo: string,
  state: PollState,
): Promise<Collected> {
  const events: GithubWireEvent[] = [];
  const errors: string[] = [];
  const runKeys: string[] = [];
  const keysBySha = new Map<string, string[]>();
  const pullKeys: string[] = [];
  let retryAfterS: number | undefined;

  // After a rate limit the rest of the pass is skipped; the caller waits and starts again.
  const attempt = async (what: string, work: () => Promise<void>): Promise<void> => {
    if (retryAfterS !== undefined) return;
    try {
      await work();
    } catch (error) {
      if (error instanceof GithubRateLimitError) retryAfterS = error.retryAfterS;
      errors.push(`${repo} ${what}: ${String(error)}`);
    }
  };

  await attempt('events', async () => {
    for (const rest of await client.repoEvents(repo)) {
      events.push(
        ...(rest.type === 'PushEvent' ? mapRestPush(repo, rest) : mapRestDelete(repo, rest)),
      );
    }
  });

  await attempt('pulls', async () => {
    for (const listed of await client.pulls(repo)) {
      const key = `${String(listed.number)}:${listed.updated_at}`;
      if (state.pulls.has(key)) continue;
      // The list omits merged_by; the single resource has it.
      const pr = listed.merged_at ? await client.pull(repo, listed.number) : listed;
      events.push(...mapPullRequestState(repo, pr));
      pullKeys.push(key);
    }
  });

  await attempt('runs', async () => {
    for (const run of await client.completedRuns(repo)) {
      const key = `${String(run.id)}:${String(run.run_attempt)}`;
      if (state.runs.has(key)) continue;
      // Posting a run without its counts would pin the sourceId to the thin version.
      try {
        const jobs = await client.jobs(repo, run.id, run.run_attempt);
        events.push(...mapWorkflowRun(repo, run, jobs));
        keysBySha.set(run.head_sha, [...(keysBySha.get(run.head_sha) ?? []), key]);
      } catch (error) {
        if (error instanceof GithubRateLimitError) throw error;
        errors.push(`${repo} jobs ${String(run.id)}: ${String(error)}`);
      }
    }
  });

  // A run counts as seen only once its check runs are read, so a failed read is retried next pass.
  for (const [sha, keys] of keysBySha) {
    await attempt(`check-runs ${sha.slice(0, 7)}`, async () => {
      for (const check of await client.checkRuns(repo, sha)) {
        events.push(...mapCheckRun(repo, check));
      }
      runKeys.push(...keys);
    });
  }

  return {
    events,
    errors,
    retryAfterS,
    commit() {
      for (const key of runKeys) state.runs.add(key);
      for (const key of pullKeys) state.pulls.add(key);
    },
  };
}

export async function pollOnce(
  client: GithubClient,
  sink: Sink,
  repos: readonly string[],
  state: PollState,
): Promise<PollOutcome> {
  const outcome: PollOutcome = {
    accepted: 0,
    duplicates: 0,
    events: 0,
    errors: [],
    retryAfterS: undefined,
  };
  for (const repo of repos) {
    const collected = await collectRepo(client, repo, state);
    outcome.errors.push(...collected.errors);
    if (collected.events.length > 0) {
      try {
        const result = await sink.post(collected.events);
        collected.commit();
        outcome.accepted += result.accepted;
        outcome.duplicates += result.duplicates;
        outcome.events += collected.events.length;
      } catch (error) {
        outcome.errors.push(`${repo} post: ${String(error)}`);
      }
    }
    if (collected.retryAfterS !== undefined) {
      outcome.retryAfterS = collected.retryAfterS;
      break;
    }
  }
  return outcome;
}
