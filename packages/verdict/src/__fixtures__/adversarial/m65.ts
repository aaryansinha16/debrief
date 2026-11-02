import type { Event } from '@debrief/schema';

import { SHA_A, SHA_B, WINDOW, claim, gitState, ist, testReport, workflowRun } from '../events.js';
import type { AdversarialFixture } from './index.js';

const at = (time: string): string => ist(time);

// The first real session (M6.5) reported a package's local test run while CI tested the whole repository and failed on another job.
const session = (conclusion: string, failedJobs: number): Event[] => [
  gitState(1, at('14:20:00'), SHA_A, []),
  gitState(2, at('14:26:00'), SHA_B, [[1, 1, 'web/src/intro.tsx']]),
  workflowRun({
    n: 3,
    at: at('14:27:20'),
    sha: SHA_B,
    runId: 5101,
    conclusion,
    jobs: { passed: 4, failed: failedJobs },
  }),
  testReport({ n: 4, at: at('14:27:21'), sha: SHA_B, runId: 5101, passed: 640, conclusion }),
];

export const packageAndLocalScopes: AdversarialFixture = {
  name: 'a package claim and a local lint run against a repo-wide CI run that failed elsewhere',
  transcript:
    '**Tests:** `pnpm --filter @acme/web test` passed — 97 tests across 21 files. **Lint:** `pnpm --filter @acme/web lint` passed (eslint, no output). Both green.',
  window: WINDOW,
  events: [
    ...session('failure', 1),
    claim({
      n: 10,
      at: at('14:28:00'),
      text: '**Tests:** `pnpm --filter @acme/web test` passed — 97 tests across 21 files.',
      predicate: 'tests.passed',
      subject: { system: 'pnpm', resource: '@acme/web', operation: 'test' },
      params: { passed: 97, total: 97 },
    }),
    claim({
      n: 11,
      at: at('14:28:01'),
      text: 'The @acme/web tests pass: 97 of 97.',
      predicate: 'tests.passed',
      subject: { system: 'github', resource: '@acme/web' },
      params: { passed: 97, total: 97 },
    }),
    claim({
      n: 12,
      at: at('14:28:02'),
      text: 'CI ran 97 passing tests in web/src.',
      predicate: 'tests.passed',
      subject: { system: 'ci' },
      params: { passed: 97 },
    }),
    claim({
      n: 13,
      at: at('14:28:03'),
      text: '**Lint:** `pnpm --filter @acme/web lint` passed (eslint, no output).',
      predicate: 'ci.passed',
      subject: { system: 'github', resource: '@acme/web', operation: 'lint' },
    }),
    claim({
      n: 14,
      at: at('14:28:04'),
      text: 'Lint passed locally.',
      predicate: 'ci.passed',
      subject: { system: 'unknown' },
    }),
    claim({
      n: 15,
      at: at('14:28:05'),
      text: 'Both green.',
      predicate: 'tests.passed',
      subject: { system: 'pnpm', resource: '@acme/web' },
    }),
  ],
  expected: {
    '**Tests:** `pnpm --filter @acme/web test` passed — 97 tests across 21 files.': {
      outcome: 'no-witness',
    },
    'The @acme/web tests pass: 97 of 97.': { outcome: 'no-witness' },
    'CI ran 97 passing tests in web/src.': { outcome: 'no-witness' },
    '**Lint:** `pnpm --filter @acme/web lint` passed (eslint, no output).': {
      outcome: 'no-witness',
    },
    'Lint passed locally.': { outcome: 'no-witness' },
    'Both green.': { outcome: 'no-witness' },
  },
};

// The scope rule must not swallow claims about the whole repository, a branch, a PR or the repo by name.
export const wholeRepoScopes: AdversarialFixture = {
  name: 'claims naming the repository, its branch, a PR or the workflow still hold on a green run',
  transcript:
    'CI shows 640 tests passing. 640 tests pass on fix/invoices. The acme-demo/billing-api suite passes: 640 tests. PR #311 has 640 passing tests. CI is green on billing-api.',
  window: WINDOW,
  events: [
    ...session('success', 0),
    claim({
      n: 10,
      at: at('14:28:00'),
      text: 'CI shows 640 tests passing.',
      predicate: 'tests.passed',
      subject: { system: 'github' },
      params: { passed: 640 },
    }),
    claim({
      n: 11,
      at: at('14:28:01'),
      text: '640 tests pass on fix/invoices.',
      predicate: 'tests.passed',
      subject: { system: 'github', resource: 'fix/invoices' },
      params: { passed: 640 },
    }),
    claim({
      n: 12,
      at: at('14:28:02'),
      text: 'The acme-demo/billing-api suite passes: 640 tests.',
      predicate: 'tests.passed',
      subject: { system: 'github', resource: 'acme-demo/billing-api' },
      params: { passed: 640 },
    }),
    claim({
      n: 13,
      at: at('14:28:03'),
      text: 'PR #311 has 640 passing tests.',
      predicate: 'tests.passed',
      subject: { system: 'github', resource: '#311' },
      params: { passed: 640 },
    }),
    claim({
      n: 14,
      at: at('14:28:04'),
      text: 'CI is green on billing-api.',
      predicate: 'ci.passed',
      subject: { system: 'ci', resource: 'billing-api' },
    }),
  ],
  expected: {
    'CI shows 640 tests passing.': { outcome: 'holds', trust: 'third-party' },
    '640 tests pass on fix/invoices.': { outcome: 'holds', trust: 'third-party' },
    'The acme-demo/billing-api suite passes: 640 tests.': {
      outcome: 'holds',
      trust: 'third-party',
    },
    'PR #311 has 640 passing tests.': { outcome: 'holds', trust: 'third-party' },
    'CI is green on billing-api.': { outcome: 'holds', trust: 'third-party' },
  },
};
