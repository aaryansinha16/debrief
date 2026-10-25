// Recorded-shape, invented values: repo, users, SHAs and ids do not exist.
export const FIXTURE_REPO = 'acme-demo/widgets';

const ALICE = { login: 'alice-dev', type: 'User' };
const CAROL = { login: 'carol-rev', type: 'User' };
const BOT = { login: 'ci-helper[bot]', type: 'Bot' };
const repository = { full_name: FIXTURE_REPO };

export const SHA_BEFORE = '1c0ffee5d1a2b3c4e5f60718293a4b5c6d7e8f90';
export const SHA_PUSH = '9f2c1ab04d7e3b58a6c91f20e4d3b7a85c6f1e02';
export const SHA_MERGE = 'b7d4e90a1c2f3856a9e0d4c7b1f28a3e5d6c9f14';

const pullRequestOpened = {
  number: 12,
  title: 'Cache widget lookups',
  state: 'open',
  created_at: '2026-10-20T09:20:00Z',
  updated_at: '2026-10-20T09:20:00Z',
  closed_at: null,
  merged_at: null,
  merge_commit_sha: null,
  user: ALICE,
  merged_by: null,
  head: { sha: SHA_PUSH, ref: 'feature/cache' },
  base: { ref: 'main' },
};

const pullRequestMerged = {
  ...pullRequestOpened,
  state: 'closed',
  updated_at: '2026-10-20T10:05:00Z',
  closed_at: '2026-10-20T10:05:00Z',
  merged_at: '2026-10-20T10:05:00Z',
  merge_commit_sha: SHA_MERGE,
  merged_by: CAROL,
};

const runSuccess = {
  id: 7001,
  name: 'ci',
  run_attempt: 1,
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  head_sha: SHA_PUSH,
  head_branch: 'feature/cache',
  updated_at: '2026-10-20T09:31:40Z',
  actor: ALICE,
  triggering_actor: ALICE,
};

const runFailure = {
  id: 7002,
  name: 'ci',
  run_attempt: 2,
  event: 'pull_request',
  status: 'completed',
  conclusion: 'failure',
  head_sha: SHA_MERGE,
  head_branch: 'main',
  updated_at: '2026-10-20T10:12:09Z',
  actor: BOT,
  triggering_actor: CAROL,
};

const checkRunDone = {
  id: 9101,
  name: 'test (node 22)',
  status: 'completed',
  conclusion: 'success',
  head_sha: SHA_PUSH,
  completed_at: '2026-10-20T09:30:12Z',
  app: { slug: 'github-actions' },
  check_suite: { id: 5501 },
};

export const jobsByRun: Record<number, { jobs: unknown[] }> = {
  7001: {
    jobs: [
      { id: 81, status: 'completed', conclusion: 'success' },
      { id: 82, status: 'completed', conclusion: 'success' },
      { id: 83, status: 'completed', conclusion: 'skipped' },
    ],
  },
  7002: {
    jobs: [
      { id: 91, status: 'completed', conclusion: 'success' },
      { id: 92, status: 'completed', conclusion: 'failure' },
      { id: 93, status: 'completed', conclusion: 'skipped' },
      { id: 94, status: 'completed', conclusion: 'cancelled' },
    ],
  },
};

export interface Delivery {
  deliveryId: string;
  event: string;
  payload: unknown;
}

export const deliveries: Delivery[] = [
  {
    deliveryId: 'd-0001',
    event: 'push',
    payload: {
      ref: 'refs/heads/feature/cache',
      before: SHA_BEFORE,
      after: SHA_PUSH,
      created: false,
      deleted: false,
      forced: false,
      repository: { ...repository, default_branch: 'main', pushed_at: 1792487702 },
      sender: ALICE,
      commits: [{ id: SHA_PUSH, message: 'cache lookups' }],
      head_commit: { id: SHA_PUSH, timestamp: '2026-10-20T09:15:00Z' },
    },
  },
  {
    deliveryId: 'd-0002',
    event: 'delete',
    payload: {
      ref: 'feature/old-cache',
      ref_type: 'branch',
      pusher_type: 'user',
      repository,
      sender: ALICE,
    },
  },
  {
    deliveryId: 'd-0003',
    event: 'pull_request',
    payload: {
      action: 'opened',
      number: 12,
      pull_request: pullRequestOpened,
      repository,
      sender: ALICE,
    },
  },
  {
    deliveryId: 'd-0004',
    event: 'pull_request',
    payload: {
      action: 'synchronize',
      number: 12,
      pull_request: pullRequestOpened,
      repository,
      sender: ALICE,
    },
  },
  {
    deliveryId: 'd-0005',
    event: 'workflow_run',
    payload: {
      action: 'requested',
      workflow_run: { ...runSuccess, status: 'queued', conclusion: null },
      repository,
    },
  },
  {
    deliveryId: 'd-0006',
    event: 'check_run',
    payload: { action: 'completed', check_run: checkRunDone, repository },
  },
  {
    deliveryId: 'd-0007',
    event: 'workflow_run',
    payload: { action: 'completed', workflow_run: runSuccess, repository },
  },
  {
    deliveryId: 'd-0008',
    event: 'pull_request',
    payload: {
      action: 'closed',
      number: 12,
      pull_request: pullRequestMerged,
      repository,
      sender: CAROL,
    },
  },
  {
    deliveryId: 'd-0009',
    event: 'workflow_run',
    payload: { action: 'completed', workflow_run: runFailure, repository },
  },
];

export const DELETE_RECEIVED_AT = '2026-10-20T09:16:30Z';

// The same facts as the REST resources a poller reads.
export const rest = {
  events: [
    {
      id: '3300000002',
      type: 'DeleteEvent',
      actor: ALICE,
      created_at: DELETE_RECEIVED_AT,
      payload: { ref: 'feature/old-cache', ref_type: 'branch', pusher_type: 'user' },
    },
    {
      id: '3300000001',
      type: 'PushEvent',
      actor: ALICE,
      created_at: '2026-10-20T09:15:02Z',
      payload: {
        push_id: 880001,
        size: 1,
        distinct_size: 1,
        ref: 'refs/heads/feature/cache',
        before: SHA_BEFORE,
        head: SHA_PUSH,
      },
    },
    {
      id: '3300000000',
      type: 'WatchEvent',
      actor: CAROL,
      created_at: '2026-10-20T09:00:00Z',
      payload: {},
    },
  ] as unknown[],
  pulls: [pullRequestMerged] as unknown[],
  pullsByNumber: { 12: pullRequestMerged } as Record<number, unknown>,
  runs: [
    runFailure,
    runSuccess,
    { ...runSuccess, id: 7003, status: 'in_progress', conclusion: null },
  ] as unknown[],
  checkRunsBySha: {
    [SHA_PUSH]: {
      check_runs: [
        checkRunDone,
        { ...checkRunDone, id: 9102, status: 'in_progress', conclusion: null, completed_at: null },
      ],
    },
    [SHA_MERGE]: { check_runs: [] },
  } as Record<string, { check_runs: unknown[] }>,
};
