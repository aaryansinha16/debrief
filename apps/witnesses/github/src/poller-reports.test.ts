import { FIXTURE_REPO } from '@debrief/witness-github/fixtures';
import { describe, expect, it } from 'vitest';

import { GithubRateLimitError, type GithubClient } from './github-api.js';
import { collectRepo, newPollState, pollOnce, REPORT_GRACE_MS } from './poller.js';
import { fixtureClient, junitArtifactZip, replayWebhooks } from './replay.js';
import { bySourceId, memorySink } from './testing.js';

const testsOf = (sink: ReturnType<typeof memorySink>) =>
  bySourceId(sink.stored.values()).filter((e) => e.target.operation === 'workflow_run.tests');

const U1 = Date.parse('2026-10-20T09:31:40Z');
const SOON = Date.parse('2026-10-20T10:13:00Z');

describe('test counts through the poller and the webhooks', () => {
  it('posts exact counts on the failing run only, and none on a run without a report', async () => {
    const sink = memorySink();
    await pollOnce(fixtureClient(), sink, [FIXTURE_REPO], newPollState());
    const [only, ...rest] = testsOf(sink);
    expect(rest).toEqual([]);
    expect(only?.target.resource).toBe('acme-demo/widgets/actions/runs/7002');
    expect(only?.attrs).toMatchObject({
      'world.tests.passed': 15,
      'world.tests.failed': 2,
      'world.tests.skipped': 2,
      'witness.trust': 'third-party',
    });
    const quiet = [...sink.stored.values()].filter((e) => e.attrs['github.run_id'] === 7001);
    expect(quiet.length).toBeGreaterThan(0);
    expect(quiet.some((e) => 'world.tests.passed' in e.attrs)).toBe(false);
  });

  it('posts a report that lands after the run, once, and stops looking after the grace', async () => {
    let ready = false;
    const base = fixtureClient();
    const client: GithubClient = {
      ...base,
      artifacts: (repo, runId) => (ready ? base.artifacts(repo, runId) : Promise.resolve([])),
      checkRuns: (repo, sha) => (ready ? base.checkRuns(repo, sha) : Promise.resolve([])),
    };
    const sink = memorySink();
    const state = newPollState();
    await pollOnce(client, sink, [FIXTURE_REPO], state, { now: () => SOON });
    expect(testsOf(sink)).toEqual([]);
    expect(state.awaitingReport.has('7002:2')).toBe(true);
    ready = true;
    const late = await pollOnce(client, sink, [FIXTURE_REPO], state, { now: () => SOON + 60_000 });
    expect(late.accepted).toBe(1);
    expect(testsOf(sink)).toHaveLength(1);
    expect(state.awaitingReport.has('7002:2')).toBe(false);
    const again = await pollOnce(client, sink, [FIXTURE_REPO], state, { now: () => SOON + 90_000 });
    expect(again.accepted).toBe(0);
    expect(testsOf(sink)).toHaveLength(1);
  });

  it('does not look again once the grace has passed', async () => {
    const base = fixtureClient();
    const asked: number[] = [];
    const client: GithubClient = {
      ...base,
      artifacts: (_repo, runId) => {
        asked.push(runId);
        return Promise.resolve([]);
      },
    };
    const state = newPollState();
    await pollOnce(client, memorySink(), [FIXTURE_REPO], state, { now: () => U1 + 1000 });
    asked.length = 0;
    await pollOnce(client, memorySink(), [FIXTURE_REPO], state, {
      now: () => U1 + REPORT_GRACE_MS,
    });
    expect(asked).toEqual([7001]);
    asked.length = 0;
    await pollOnce(client, memorySink(), [FIXTURE_REPO], state, {
      now: () => U1 + REPORT_GRACE_MS + 1,
    });
    expect(asked).toEqual([]);
  });

  it('does not wait on runs that finished long before the poller started', async () => {
    const state = newPollState();
    const asked: number[] = [];
    const client: GithubClient = {
      ...fixtureClient(),
      artifacts: (_repo, runId) => {
        asked.push(runId);
        return Promise.resolve([]);
      },
    };
    await pollOnce(client, memorySink(), [FIXTURE_REPO], state, { now: () => SOON + 86_400_000 });
    expect(state.awaitingReport.size).toBe(0);
    asked.length = 0;
    await pollOnce(client, memorySink(), [FIXTURE_REPO], state, { now: () => SOON + 86_400_000 });
    expect(asked).toEqual([]);
  });

  it('stops re-reading a late report that was refused, even when the pass posts nothing', async () => {
    let zip: Uint8Array = new Uint8Array();
    const base = fixtureClient();
    const client: GithubClient = {
      ...base,
      repoEvents: () => Promise.resolve([]),
      pulls: () => Promise.resolve([]),
      checkRuns: () => Promise.resolve([]),
      artifacts: () =>
        Promise.resolve(
          zip.length === 0
            ? []
            : [
                {
                  id: 1,
                  name: 'junit',
                  size_in_bytes: 3,
                  expired: false,
                  created_at: '2026-10-20T10:10:00Z',
                },
              ],
        ),
      artifactZip: () => Promise.resolve(zip),
    };
    const state = newPollState();
    await pollOnce(client, memorySink(), [FIXTURE_REPO], state, { now: () => SOON });
    expect(state.awaitingReport.has('7002:2')).toBe(true);
    zip = new Uint8Array([1, 2, 3]);
    const logged: string[] = [];
    await pollOnce(client, memorySink(), [FIXTURE_REPO], state, {
      now: () => SOON,
      log: (m) => logged.push(m),
    });
    expect(logged).toHaveLength(1);
    expect(state.awaitingReport.size).toBe(0);
    await pollOnce(client, memorySink(), [FIXTURE_REPO], state, {
      now: () => SOON,
      log: (m) => logged.push(m),
    });
    expect(logged).toHaveLength(1);
  });

  it('retries a report it could not read and stops the pass on a rate limit', async () => {
    const base = fixtureClient();
    const broken: GithubClient = { ...base, artifacts: () => Promise.reject(new Error('boom')) };
    const state = newPollState();
    const outcome = await pollOnce(broken, memorySink(), [FIXTURE_REPO], state, {
      now: () => SOON,
    });
    expect(outcome.errors.filter((e) => e.includes('tests 700'))).toHaveLength(2);
    expect(state.awaitingReport.size).toBe(1);
    const limited: GithubClient = {
      ...base,
      artifacts: () => Promise.reject(new GithubRateLimitError(30)),
    };
    const stopped = await pollOnce(limited, memorySink(), [FIXTURE_REPO], newPollState());
    expect(stopped.retryAfterS).toBe(30);
  });

  it('logs why a malformed report posts no counts, with or without a logger', async () => {
    const base = fixtureClient();
    const client: GithubClient = {
      ...base,
      artifactZip: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    };
    const logged: string[] = [];
    const collected = await collectRepo(client, FIXTURE_REPO, newPollState(), {
      log: (message) => logged.push(message),
    });
    expect(logged).toEqual([
      'acme-demo/widgets run 7002: no test counts posted, artifact is not a readable zip',
    ]);
    expect(collected.events.some((e) => e.target.operation === 'workflow_run.tests')).toBe(false);
    await collectRepo(client, FIXTURE_REPO, newPollState());
    const sink = memorySink();
    await replayWebhooks(sink, client);
    expect(testsOf(sink)).toEqual([]);
  });

  it('keeps the zip out of every event', async () => {
    const sink = memorySink();
    await pollOnce(fixtureClient(), sink, [FIXTURE_REPO], newPollState());
    const text = JSON.stringify([...sink.stored.values()]);
    expect(text).not.toContain('testcase');
    expect(junitArtifactZip().length).toBeGreaterThan(0);
  });
});
