import { eventInputSchema, isReservedAttribute } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import { DELETE_RECEIVED_AT, deliveries, jobsByRun, rest } from './__fixtures__/index.js';
import {
  countJobs,
  mapCheckRun,
  mapPullRequestState,
  mapRestDelete,
  mapRestPush,
  mapWebhook,
  mapWorkflowRun,
  parsePayload,
  pullRequestSchema,
  restDeleteEventSchema,
  restPushEventSchema,
  runIdFor,
  WitnessPayloadError,
  workflowRunSchema,
} from './index.js';

const replay = () =>
  deliveries.flatMap((delivery) => {
    const body = delivery.payload as { workflow_run?: { id: number } };
    const runId = body.workflow_run?.id;
    const jobs = runId === undefined ? undefined : jobsByRun[runId]?.jobs;
    return mapWebhook(delivery.event, delivery.payload, {
      receivedAt: DELETE_RECEIVED_AT,
      ...(jobs === undefined ? {} : { jobs: jobs as never }),
    });
  });

describe('witness-github mapping', () => {
  it('maps the recorded deliveries to the golden events', async () => {
    await expect(JSON.stringify(replay(), null, 2) + '\n').toMatchFileSnapshot(
      './__golden__/webhook-events.json',
    );
  });

  it('produces events the ingest schema accepts, within the witness rules', () => {
    const events = replay();
    expect(events).toHaveLength(7);
    for (const wire of events) {
      const { sourceId: _sourceId, ...rest } = wire;
      const parsed = eventInputSchema.safeParse({
        ...rest,
        id: '01JZ0000000000000000000000',
        ts: '2026-10-20T12:00:00.000Z',
        tenantId: 't1',
      });
      expect(parsed.error?.issues).toBeUndefined();
      expect(wire.attrs['witness.trust']).toBe('third-party');
      expect(wire.summary.length).toBeLessThanOrEqual(280);
      expect(wire.runId).toBe(runIdFor(wire.sourceTs));
      expect(wire.target.system).toBe('github');
      for (const name of Object.keys(wire.attrs)) {
        if (isReservedAttribute(name)) expect(name).toBe('witness.trust');
      }
    }
    expect(new Set(events.map((e) => e.sourceId)).size).toBe(events.length);
  });

  it('counts jobs by conclusion and carries the sha and actor', () => {
    const [success] = mapWorkflowRun(
      'acme-demo/widgets',
      workflowRunSchema.parse(rest.runs[1]),
      jobsByRun[7001]?.jobs as never,
    );
    expect(success?.attrs).toMatchObject({
      'commit.sha': '9f2c1ab04d7e3b58a6c91f20e4d3b7a85c6f1e02',
      'github.actor': 'alice-dev',
      'ci.counts.of': 'jobs',
      'ci.jobs.passed': 2,
      'ci.jobs.failed': 0,
      'ci.jobs.skipped': 1,
    });
    expect(countJobs([{ id: 1, status: 'completed', conclusion: 'timed_out' }]).failed).toBe(1);
    expect(countJobs([{ id: 1, status: 'completed', conclusion: 'neutral' }]).skipped).toBe(1);
  });

  it('omits counts rather than invent them when jobs are unknown', () => {
    const [event] = mapWorkflowRun('acme-demo/widgets', workflowRunSchema.parse(rest.runs[1]));
    expect(Object.keys(event?.attrs ?? {}).filter((k) => k.startsWith('ci.jobs'))).toEqual([]);
    expect(event?.summary).toContain('job counts unavailable');
  });

  it('ignores runs and checks that have not finished', () => {
    expect(mapWorkflowRun('a/b', workflowRunSchema.parse(rest.runs[2]))).toEqual([]);
    const pending = {
      id: 1,
      name: 'x',
      status: 'in_progress',
      conclusion: null,
      head_sha: 'abc',
      completed_at: null,
    };
    expect(mapCheckRun('a/b', pending)).toEqual([]);
  });

  it('ignores unsupported events and actions', () => {
    expect(mapWebhook('star', {})).toEqual([]);
    const check = deliveries[5]?.payload as Record<string, unknown>;
    expect(mapWebhook('check_run', { ...check, action: 'created' })).toEqual([]);
    for (const index of [3, 4]) {
      const delivery = deliveries[index];
      expect(mapWebhook(delivery?.event ?? '', delivery?.payload)).toEqual([]);
    }
  });

  it('skips the push that deletes a ref and tags the rest', () => {
    const base = deliveries[0]?.payload as Record<string, unknown>;
    expect(mapWebhook('push', { ...base, after: '0'.repeat(40) })).toEqual([]);
    const [created] = mapWebhook('push', { ...base, before: '0'.repeat(40), ref: 'refs/tags/v1' });
    expect(created?.target.operation).toBe('create_tag');
    expect(created?.attrs).not.toHaveProperty('commit.before');
    const [tagDelete] = mapWebhook('delete', {
      ref: 'v0',
      ref_type: 'tag',
      repository: { full_name: 'a/b' },
      sender: { login: 'x[bot]', type: 'Bot' },
    });
    expect(tagDelete?.target.resource).toBe('a/b@refs/tags/v0');
    expect(tagDelete?.actor.type).toBe('system');
  });

  it('maps a closed, unmerged pull request to a system actor', () => {
    const pr = pullRequestSchema.parse({
      ...(rest.pulls[0] as object),
      merged_at: null,
      merged_by: null,
    });
    const events = mapPullRequestState('a/b', pr);
    expect(events.map((e) => e.target.operation)).toEqual([
      'pull_request.opened',
      'pull_request.closed',
    ]);
    expect(events[1]?.actor).toEqual({ type: 'system', id: 'github' });
    const reopened = mapWebhook('pull_request', {
      action: 'reopened',
      pull_request: pr,
      repository: { full_name: 'a/b' },
    });
    expect(reopened[0]?.target.operation).toBe('pull_request.reopened');
  });

  it('reads REST push and delete events like their webhooks', () => {
    const [push] = mapRestPush('a/b', restPushEventSchema.parse(rest.events[1]));
    const [del] = mapRestDelete('a/b', restDeleteEventSchema.parse(rest.events[0]));
    expect(push?.target.operation).toBe('push_branch');
    expect(del?.sourceTs).toBe('2026-10-20T09:16:30.000Z');
  });

  it('redacts secrets out of free text', () => {
    const run = workflowRunSchema.parse({
      ...(rest.runs[1] as object),
      name: 'deploy ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    });
    const [event] = mapWorkflowRun('a/b', run);
    expect(JSON.stringify(event)).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('throws a typed error on a malformed payload', () => {
    expect(() => mapWebhook('push', { ref: 1 })).toThrow(WitnessPayloadError);
    expect(() => parsePayload('x', workflowRunSchema, {})).toThrow(/x: /);
    expect(() => parsePayload('x', workflowRunSchema, 7)).toThrow(WitnessPayloadError);
  });
});
