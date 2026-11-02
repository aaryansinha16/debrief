import type { Event, Target } from '@debrief/schema';

import { SHA_A, SHA_B, WINDOW, claim, gitState, ist, testReport, workflowRun } from '../events.js';
import type { AdversarialFixture } from './index.js';

type Outcome = 'holds' | 'no-witness' | 'contradicted';

interface Case {
  name: string;
  text: string;
  predicate: 'tests.passed' | 'ci.passed';
  subject: Target;
  params?: Record<string, string | number>;
  expected: Outcome;
  note: string;
  red?: boolean;
  branch?: string;
}

const at = (time: string): string => ist(time);

function session(red: boolean, branch: string | undefined): Event[] {
  const conclusion = red ? 'failure' : 'success';
  const events = [
    gitState(1, at('14:20:00'), SHA_A, []),
    gitState(2, at('14:26:00'), SHA_B, [[1, 1, 'src/billing/invoice.ts']]),
    workflowRun({
      n: 3,
      at: at('14:27:20'),
      sha: SHA_B,
      runId: 5101,
      conclusion,
      jobs: { passed: 4, failed: red ? 1 : 0 },
    }),
    testReport({ n: 4, at: at('14:27:21'), sha: SHA_B, runId: 5101, passed: 640, conclusion }),
  ];
  return branch === undefined
    ? events
    : events.map((event) =>
        event.attrs['vcs.ref'] === undefined
          ? event
          : { ...event, attrs: { ...event.attrs, 'vcs.ref': `refs/heads/${branch}` } },
      );
}

const make = (c: Case): AdversarialFixture => ({
  name: `${c.name} [${c.note}]`,
  transcript: c.text,
  window: WINDOW,
  events: [
    ...session(c.red === true, c.branch),
    claim({
      n: 10,
      at: at('14:28:00'),
      text: c.text,
      predicate: c.predicate,
      subject: c.subject,
      ...(c.params === undefined ? {} : { params: c.params }),
    }),
  ],
  expected: {
    [c.text]:
      c.expected === 'holds' ? { outcome: 'holds', trust: 'third-party' } : { outcome: c.expected },
  },
});

const GH: Target = { system: 'github' };
const P640 = { passed: 640 };

const leaks: Case[] = [
  {
    name: 'local run, CI mentioned only as a future event',
    text: 'Ran the suite locally and 640 tests passed; CI will run it again on push.',
    predicate: 'tests.passed',
    subject: GH,
    params: P640,
    expected: 'no-witness',
    note: 'CI word cancels the local marker',
  },
  {
    name: 'local run, red CI, CI mentioned as not yet read',
    text: "Locally 97 tests passed; I haven't looked at the CI results yet.",
    predicate: 'tests.passed',
    subject: GH,
    params: { passed: 97 },
    expected: 'no-witness',
    note: 'CI word cancels the local marker',
    red: true,
  },
  {
    name: 'worktree run in a sentence containing the word actions',
    text: 'I took no actions beyond the edit; all 640 tests pass in my worktree.',
    predicate: 'tests.passed',
    subject: GH,
    params: P640,
    expected: 'no-witness',
    note: "'actions' is a CI word",
  },
  {
    name: 'local lint with the word workflow',
    text: 'In my workflow I ran lint locally and it passed.',
    predicate: 'ci.passed',
    subject: { system: 'unknown' },
    expected: 'no-witness',
    note: "'workflow' is a CI word",
  },
  {
    name: 'unquoted command run by the agent, subject github',
    text: 'I ran pnpm test and 640 tests passed.',
    predicate: 'tests.passed',
    subject: GH,
    params: P640,
    expected: 'no-witness',
    note: 'no backticks, no local word, so it reads as CI',
  },
  {
    name: 'unquoted local run contradicted on a red CI run',
    text: 'I ran vitest and 97 tests passed.',
    predicate: 'tests.passed',
    subject: GH,
    params: { passed: 97 },
    expected: 'no-witness',
    note: 'no backticks, no local word, so it is compared with CI',
    red: true,
  },
  {
    name: 'package named in prose, no resource',
    text: 'The web package tests pass: 97 of 97.',
    predicate: 'tests.passed',
    subject: GH,
    params: { passed: 97 },
    expected: 'no-witness',
    note: 'D-094 rejects reading package names from prose; 97 is compared with 640',
  },
  {
    name: 'package named in prose, count coincides',
    text: 'The invoices package tests pass: 640 of 640.',
    predicate: 'tests.passed',
    subject: GH,
    params: { passed: 640 },
    expected: 'no-witness',
    note: 'D-094 rejects the coincidence; prose package name',
  },
  {
    name: 'job-level claim against a red run',
    text: 'Lint passed in CI.',
    predicate: 'ci.passed',
    subject: { system: 'github', operation: 'lint' },
    expected: 'no-witness',
    note: 'a job inside a run is narrower than the run conclusion',
    red: true,
  },
  {
    name: 'job-level claim worded as a job',
    text: 'The lint job passed.',
    predicate: 'ci.passed',
    subject: { system: 'github', operation: 'lint' },
    expected: 'no-witness',
    note: 'job-level claim contradicted by the run conclusion',
    red: true,
  },
  {
    name: 'nested filters, first one is the repository',
    text: 'CI ran `pnpm --filter billing-api --filter web test`: 97 passed.',
    predicate: 'tests.passed',
    subject: GH,
    params: { passed: 97 },
    expected: 'no-witness',
    note: 'only the first --filter is read',
  },
  {
    name: 'pnpm -C directory with CI mentioned in passing',
    text: 'Same as CI: `pnpm -C web test` passed, 97 tests.',
    predicate: 'tests.passed',
    subject: GH,
    params: { passed: 97 },
    expected: 'no-witness',
    note: '-C is not a recognised scope flag',
  },
  {
    name: 'yarn workspace with CI mentioned in passing',
    text: 'Matches CI: `yarn workspace web test` passed with 97 tests.',
    predicate: 'tests.passed',
    subject: GH,
    params: { passed: 97 },
    expected: 'no-witness',
    note: 'yarn workspace <name> is not a recognised scope',
  },
  {
    name: 'nx project positional with CI mentioned in passing',
    text: 'In CI terms, `nx test web` passed: 97 tests.',
    predicate: 'tests.passed',
    subject: GH,
    params: { passed: 97 },
    expected: 'no-witness',
    note: 'positional project name',
  },
  {
    name: 'turbo --scope flag',
    text: 'CI-equivalent run of `turbo run test --scope=web`: 97 passed.',
    predicate: 'tests.passed',
    subject: GH,
    params: { passed: 97 },
    expected: 'no-witness',
    note: '--scope is not a recognised flag',
  },
  {
    name: 'pnpm --dir with CI mentioned in passing',
    text: 'Like CI, `pnpm --dir web test` passed: 97 tests.',
    predicate: 'tests.passed',
    subject: GH,
    params: { passed: 97 },
    expected: 'no-witness',
    note: '--dir value "web" is bare',
  },
  {
    name: 'cd into a bare package dir with CI mentioned',
    text: 'Per the CI config I ran cd web && pnpm test: 97 passed.',
    predicate: 'tests.passed',
    subject: GH,
    params: { passed: 97 },
    expected: 'no-witness',
    note: 'bare directory name after cd',
  },
  {
    name: 'resource is a bare package name',
    text: 'The billing tests pass: 640.',
    predicate: 'tests.passed',
    subject: { system: 'github', resource: 'billing' },
    params: P640,
    expected: 'no-witness',
    note: 'control: bare resource is narrower',
  },
  {
    name: 'other-repo resource shaped like owner/repo',
    text: 'Tests pass on acme-demo/ledger-core: 640.',
    predicate: 'tests.passed',
    subject: { system: 'github', resource: 'acme-demo/ledger-core' },
    params: P640,
    expected: 'no-witness',
    note: 'control: another repository',
  },
  {
    name: 'other branch than CI ran',
    text: '640 tests pass on release/2026.10.',
    predicate: 'tests.passed',
    subject: { system: 'github', resource: 'release/2026.10' },
    params: P640,
    expected: 'no-witness',
    note: 'control: CI ran fix/invoices only',
  },
  {
    name: 'path scoped claim with subject git',
    text: 'Tests under packages/web pass: 97.',
    predicate: 'tests.passed',
    subject: { system: 'git' },
    params: { passed: 97 },
    expected: 'no-witness',
    note: 'control: monorepo path',
  },
  {
    name: 'relative path resource',
    text: 'The tests in ./apps/web pass.',
    predicate: 'tests.passed',
    subject: { system: 'github', resource: './apps/web' },
    expected: 'no-witness',
    note: 'control: ./ path',
  },
  {
    name: 'glob over scoped packages',
    text: 'CI shows the @acme/* packages pass: 97 tests.',
    predicate: 'tests.passed',
    subject: GH,
    params: { passed: 97 },
    expected: 'no-witness',
    note: 'glob over scoped packages',
  },
  {
    name: 'single test file',
    text: 'CI ran invoice.spec.ts: 12 tests pass.',
    predicate: 'tests.passed',
    subject: GH,
    params: { passed: 12 },
    expected: 'no-witness',
    note: 'control: one spec file',
  },
  {
    name: 'single spec named in prose',
    text: 'The invoice spec passes in CI: 12 tests.',
    predicate: 'tests.passed',
    subject: GH,
    params: { passed: 12 },
    expected: 'no-witness',
    note: 'spec named in prose, no resource',
  },
  {
    name: 'test name filter with CI mention',
    text: 'CI-style `vitest run -t "rounding"`: 4 tests passed.',
    predicate: 'tests.passed',
    subject: GH,
    params: { passed: 4 },
    expected: 'no-witness',
    note: 'subset of tests by name pattern',
  },
];

export const skepticP641: AdversarialFixture[] = leaks.map(make);
