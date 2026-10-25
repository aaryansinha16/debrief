import { FIXTURE_REPO } from '@debrief/witness-github/fixtures';
import { describe, expect, it } from 'vitest';

import { GithubApiError, type GithubClient, GithubRateLimitError } from './github-api.js';
import { collectRepo, newPollState, pollOnce } from './poller.js';
import { collectFixturePoll, fixtureClient, replayPoll, replayWebhooks } from './replay.js';
import { SinkError, type Sink } from './sink.js';
import { bySourceId, memorySink } from './testing.js';

function counting(overrides: Partial<GithubClient> = {}) {
  const calls: string[] = [];
  const base = fixtureClient();
  const client = Object.fromEntries(
    (Object.keys(base) as (keyof GithubClient)[]).map((name) => [
      name,
      (...args: unknown[]) => {
        calls.push(name);
        const target = Reflect.get({ ...base, ...overrides }, name) as (...a: unknown[]) => unknown;
        return target(...args);
      },
    ]),
  ) as unknown as GithubClient;
  return { client, calls };
}

describe('poller against webhooks', () => {
  it('produces the same events for the same fixture', async () => {
    const hooks = memorySink();
    await replayWebhooks(hooks, fixtureClient());
    const polled = memorySink();
    await replayPoll(polled);
    expect(bySourceId(hooks.stored.values())).toEqual(bySourceId(polled.stored.values()));
    expect(hooks.stored.size).toBe(7);
  });

  it('stores a redelivered event once', async () => {
    const sink = memorySink();
    const first = await replayWebhooks(sink, fixtureClient());
    const second = await replayWebhooks(sink);
    const polled = await replayPoll(sink);
    expect(first).toEqual({ accepted: 7, duplicates: 0 });
    expect(second.accepted).toBe(0);
    expect(polled.accepted).toBe(0);
    expect(sink.stored.size).toBe(7);
  });
});

describe('poller requests', () => {
  it('costs three requests when nothing is new', async () => {
    const { client, calls } = counting();
    const sink = memorySink();
    const state = newPollState();
    await pollOnce(client, sink, [FIXTURE_REPO], state);
    expect(calls).toContain('checkRuns');
    calls.length = 0;
    const again = await pollOnce(client, sink, [FIXTURE_REPO], state);
    expect(calls.sort()).toEqual(['completedRuns', 'pulls', 'repoEvents']);
    expect(again.duplicates).toBe(2);
    expect(again.accepted).toBe(0);
  });

  it('asks for check runs only for the shas of new runs', async () => {
    const { client, calls } = counting();
    const state = newPollState();
    state.runs.add('7001:1');
    const sink = memorySink();
    await pollOnce(client, sink, [FIXTURE_REPO], state);
    expect(calls.filter((c) => c === 'jobs')).toHaveLength(1);
    expect(calls.filter((c) => c === 'checkRuns')).toHaveLength(1);
  });

  it('holds a run back, and its check runs, when its jobs cannot be read', async () => {
    const { client, calls } = counting({
      jobs: () => Promise.reject(new GithubApiError(403, '/jobs')),
    });
    const collected = await collectRepo(client, FIXTURE_REPO, newPollState());
    expect(collected.events.some((e) => e.target.operation === 'workflow_run.completed')).toBe(
      false,
    );
    expect(collected.errors.join()).toContain('jobs 7002');
    expect(calls).not.toContain('checkRuns');
    expect((await collectFixturePoll()).errors).toEqual([]);
  });

  it('stops the pass on a rate limit and reports how long to wait', async () => {
    const { client, calls } = counting({
      completedRuns: () => Promise.reject(new GithubRateLimitError(45)),
    });
    const sink = memorySink();
    const outcome = await pollOnce(client, sink, [FIXTURE_REPO, 'other/repo'], newPollState());
    expect(outcome.retryAfterS).toBe(45);
    expect(calls).not.toContain('checkRuns');
    expect(calls.filter((c) => c === 'repoEvents')).toHaveLength(1);
    expect(sink.stored.size).toBeGreaterThan(0);
  });

  it('stops the pass on a rate limit raised while reading jobs', async () => {
    const { client, calls } = counting({
      jobs: () => Promise.reject(new GithubRateLimitError(5)),
    });
    const outcome = await pollOnce(client, memorySink(), [FIXTURE_REPO], newPollState());
    expect(outcome.retryAfterS).toBe(5);
    expect(calls.filter((c) => c === 'jobs')).toHaveLength(1);
  });

  it('reports a failed post and tries again next pass', async () => {
    const sink: Sink = { post: () => Promise.reject(new SinkError(503)) };
    const state = newPollState();
    const outcome = await pollOnce(fixtureClient(), sink, [FIXTURE_REPO], state);
    expect(outcome.errors.join()).toContain('post');
    expect(state.runs.size).toBe(0);
  });

  it('skips every later request once the first is rate limited', async () => {
    const { client, calls } = counting({
      repoEvents: () => Promise.reject(new GithubRateLimitError(9)),
    });
    const outcome = await pollOnce(client, memorySink(), [FIXTURE_REPO], newPollState());
    expect(outcome.retryAfterS).toBe(9);
    expect(calls).toEqual(['repoEvents']);
  });

  it('posts an open pull request from the list without fetching it again', async () => {
    const [merged] = await fixtureClient().pulls(FIXTURE_REPO);
    const open = { ...merged!, state: 'open', merged_at: null, merged_by: null };
    const { client, calls } = counting({ pulls: () => Promise.resolve([open]) });
    const sink = memorySink();
    await pollOnce(client, sink, [FIXTURE_REPO], newPollState());
    expect(calls).not.toContain('pull');
    expect([...sink.stored.keys()].filter((id) => id.includes('pull_request'))).toHaveLength(1);
  });

  it('keeps going when one resource fails', async () => {
    const { client } = counting({
      repoEvents: () => Promise.reject(new GithubApiError(500, '/events')),
      checkRuns: () => Promise.reject(new Error('boom')),
    });
    const outcome = await pollOnce(client, memorySink(), [FIXTURE_REPO], newPollState());
    expect(outcome.errors).toHaveLength(3);
    expect(outcome.errors.join()).toContain('boom');
    expect(outcome.events).toBeGreaterThan(0);
  });

  it('posts nothing when nothing is listed', async () => {
    const { client } = counting({
      repoEvents: () => Promise.resolve([]),
      pulls: () => Promise.resolve([]),
      completedRuns: () => Promise.resolve([]),
    });
    const sink = memorySink();
    const outcome = await pollOnce(client, sink, [FIXTURE_REPO], newPollState());
    expect(sink.calls).toBe(0);
    expect(outcome).toMatchObject({ events: 0, retryAfterS: undefined });
  });
});
