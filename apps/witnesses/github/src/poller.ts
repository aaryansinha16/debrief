import {
  type GithubWireEvent,
  mapCheckRun,
  mapPullRequestState,
  mapRestDelete,
  mapRestPush,
  mapWorkflowRun,
} from '@debrief/witness-github';

import type { GithubClient } from './github-api.js';
import type { IngestResult, Sink } from './sink.js';

export interface PollState {
  runs: Set<string>;
  pulls: Set<string>;
}

export const newPollState = (): PollState => ({ runs: new Set(), pulls: new Set() });

export interface PollOutcome extends IngestResult {
  events: number;
  errors: string[];
}

// Everything is derived from what GitHub lists now; sourceIds make repeating a pass harmless.
export async function collectRepo(
  client: GithubClient,
  repo: string,
  state: PollState,
): Promise<{ events: GithubWireEvent[]; commit: () => void; errors: string[] }> {
  const events: GithubWireEvent[] = [];
  const errors: string[] = [];
  const runKeys: string[] = [];
  const pullKeys: string[] = [];
  const attempt = async (what: string, work: () => Promise<void>): Promise<void> => {
    try {
      await work();
    } catch (error) {
      errors.push(`${repo} ${what}: ${error instanceof Error ? error.message : 'failed'}`);
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

  const shas = new Set<string>();
  await attempt('runs', async () => {
    for (const run of await client.completedRuns(repo)) {
      shas.add(run.head_sha);
      const key = `${String(run.id)}:${String(run.run_attempt)}`;
      if (state.runs.has(key)) continue;
      try {
        events.push(...mapWorkflowRun(repo, run, await client.jobs(repo, run.id)));
        runKeys.push(key);
      } catch (error) {
        // Posting a run without its counts would pin the sourceId to the thin version.
        errors.push(
          `${repo} jobs ${String(run.id)}: ${error instanceof Error ? error.message : 'failed'}`,
        );
      }
    }
  });

  for (const sha of shas) {
    await attempt(`check-runs ${sha.slice(0, 7)}`, async () => {
      for (const check of await client.checkRuns(repo, sha))
        events.push(...mapCheckRun(repo, check));
    });
  }

  return {
    events,
    errors,
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
  const outcome: PollOutcome = { accepted: 0, duplicates: 0, events: 0, errors: [] };
  for (const repo of repos) {
    const collected = await collectRepo(client, repo, state);
    outcome.errors.push(...collected.errors);
    if (collected.events.length === 0) continue;
    try {
      const result = await sink.post(collected.events);
      collected.commit();
      outcome.accepted += result.accepted;
      outcome.duplicates += result.duplicates;
      outcome.events += collected.events.length;
    } catch (error) {
      outcome.errors.push(`${repo} post: ${error instanceof Error ? error.message : 'failed'}`);
    }
  }
  return outcome;
}
