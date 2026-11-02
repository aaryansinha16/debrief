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
  workflow?: string;
}

const at = (time: string): string => ist(time);

function session(c: Case): Event[] {
  const conclusion = c.red === true ? 'failure' : 'success';
  const workflow = c.workflow === undefined ? {} : { workflow: c.workflow };
  const events = [
    gitState(1, at('14:20:00'), SHA_A, []),
    gitState(2, at('14:26:00'), SHA_B, [[1, 1, 'src/billing/invoice.ts']]),
    workflowRun({
      n: 3,
      at: at('14:27:20'),
      sha: SHA_B,
      runId: 5101,
      conclusion,
      jobs: { passed: 4, failed: c.red === true ? 1 : 0 },
      ...workflow,
    }),
    testReport({
      n: 4,
      at: at('14:27:21'),
      sha: SHA_B,
      runId: 5101,
      passed: 640,
      conclusion,
      ...workflow,
    }),
  ];
  return c.branch === undefined
    ? events
    : events.map((event) =>
        event.attrs['vcs.ref'] === undefined
          ? event
          : { ...event, attrs: { ...event.attrs, 'vcs.ref': `refs/heads/${String(c.branch)}` } },
      );
}

const make = (c: Case): AdversarialFixture => ({
  name: `${c.name} [${c.note}]`,
  transcript: c.text,
  window: WINDOW,
  events: [
    ...session(c),
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
const P97 = { passed: 97 };

const localSlips: Case[] = [
  {
    name: 'local run on a workstation',
    text: 'Ran the suite on my workstation: 640 tests passed.',
    predicate: 'tests.passed',
    subject: GH,
    params: P640,
    expected: 'no-witness',
    note: 'LOCAL_PHRASE lists machine/laptop/computer but not workstation',
  },
  {
    name: 'local run, on my box',
    text: 'On my box all 640 tests pass.',
    predicate: 'tests.passed',
    subject: GH,
    params: P640,
    expected: 'no-witness',
    note: 'colloquial local phrase',
  },
  {
    name: 'local run, here',
    text: 'Tests passed here: 97 of them.',
    predicate: 'tests.passed',
    subject: GH,
    params: P97,
    expected: 'no-witness',
    note: "'here' is the agent's machine",
    red: true,
  },
  {
    name: 'go test in backticks',
    text: 'Ran `go test ./...`: 97 passed.',
    predicate: 'tests.passed',
    subject: GH,
    params: P97,
    expected: 'no-witness',
    note: 'go is not in RUNNERS',
    red: true,
  },
  {
    name: 'dotnet test unquoted',
    text: 'dotnet test passed: 97 tests.',
    predicate: 'tests.passed',
    subject: GH,
    params: P97,
    expected: 'no-witness',
    note: 'dotnet is not in RUNNERS',
    red: true,
  },
  {
    name: 'make test unquoted',
    text: 'make test passed with 97 tests.',
    predicate: 'tests.passed',
    subject: GH,
    params: P97,
    expected: 'no-witness',
    note: 'make is only matched when backticked',
    red: true,
  },
  {
    name: 'I just ran',
    text: 'I just ran the tests and 97 passed.',
    predicate: 'tests.passed',
    subject: GH,
    params: P97,
    expected: 'no-witness',
    note: "I_RAN does not allow 'just'",
    red: true,
  },
  {
    name: "I've run",
    text: "I've run the suite: 97 tests passed.",
    predicate: 'tests.passed',
    subject: GH,
    params: P97,
    expected: 'no-witness',
    note: 'I_RAN does not match "I\'ve run"',
    red: true,
  },
  {
    name: 'we ran',
    text: 'We ran the tests and 97 passed.',
    predicate: 'tests.passed',
    subject: GH,
    params: P97,
    expected: 'no-witness',
    note: 'I_RAN is first person singular only',
    red: true,
  },
];

const ciDidOverrides: Case[] = [
  {
    name: 'local run before CI runs it',
    text: 'I ran `pnpm test` before CI runs it: 97 passed.',
    predicate: 'tests.passed',
    subject: GH,
    params: P97,
    expected: 'no-witness',
    note: "'CI runs' cancels the local reading",
    red: true,
  },
  {
    name: 'local result compared to what CI reports',
    text: '`pnpm test` passed: 97, the same as CI reports.',
    predicate: 'tests.passed',
    subject: GH,
    params: P97,
    expected: 'no-witness',
    note: "'CI reports' used as a comparison",
    red: true,
  },
  {
    name: 'local run in a clean checkout, CI will show the same',
    text: 'I ran the suite in a clean checkout, and CI will show the same: 97 passed.',
    predicate: 'tests.passed',
    subject: GH,
    params: P97,
    expected: 'no-witness',
    note: "'CI will show' cancels the local reading",
    red: true,
  },
  {
    name: 'quoted command in CI mode',
    text: '`pnpm test` passed in CI mode: 97 tests.',
    predicate: 'tests.passed',
    subject: GH,
    params: P97,
    expected: 'no-witness',
    note: "'in CI mode' is not excluded like 'in CI terms'",
    red: true,
  },
  {
    name: 'rerun of a failing test taken from CI logs',
    text: 'I ran the slow test again, the one copied from CI: 97 passed.',
    predicate: 'tests.passed',
    subject: GH,
    params: P97,
    expected: 'no-witness',
    note: "'from CI' matches CI_DID before I_RAN is read",
    red: true,
  },
];

const localWrongRefusals: Case[] = [
  {
    name: 'CI reused a local build cache',
    text: 'CI reused the local build cache and all 640 tests passed.',
    predicate: 'tests.passed',
    subject: GH,
    params: P640,
    expected: 'holds',
    note: "LOCAL_PHRASE 'local build' is read before CI_DID",
  },
  {
    name: 'CI green after deleting a local build script',
    text: 'CI is green after I deleted the local build script.',
    predicate: 'ci.passed',
    subject: GH,
    expected: 'holds',
    note: "LOCAL_PHRASE 'local build' is read before CI_DID",
  },
  {
    name: 'CI green, no longer needed locally',
    text: 'CI is green, so nobody needs to run the suite locally any more.',
    predicate: 'ci.passed',
    subject: GH,
    expected: 'no-witness',
    note: "judgment, kept refused: 'locally' always wins (D-094)",
  },
  {
    name: 'ran into a flaky test, repo-wide pass',
    text: 'I ran into a flaky test earlier, but all 640 tests pass on the PR.',
    predicate: 'tests.passed',
    subject: GH,
    params: P640,
    expected: 'holds',
    note: "judgment: 'I ran into' is not running tests",
  },
  {
    name: 'next-step command word after a repo-wide claim',
    text: 'All 640 tests pass; next I will yarn install the new lockfile.',
    predicate: 'tests.passed',
    subject: GH,
    params: P640,
    expected: 'holds',
    note: "judgment: 'yarn install' is a future step, not the run claimed",
  },
  {
    name: 'extractor says where ci but the sentence names a tool',
    text: 'The pipeline passed 640 tests via pnpm test.',
    predicate: 'tests.passed',
    subject: { system: 'pnpm' },
    params: { passed: 640, where: 'ci' },
    expected: 'holds',
    note: "control: where 'ci' wins",
  },
  {
    name: 'extractor says where local, sentence reads like CI',
    text: 'CI passed 640 tests.',
    predicate: 'tests.passed',
    subject: GH,
    params: { passed: 640, where: 'local' },
    expected: 'no-witness',
    note: "control: where 'local' wins",
  },
];

const scopeSlips: Case[] = [
  {
    name: 'bare path then count',
    text: 'CI: apps/web 97 tests passed.',
    predicate: 'tests.passed',
    subject: GH,
    params: P97,
    expected: 'no-witness',
    note: 'path-shaped scope with no flag or phrase pattern',
    red: true,
  },
  {
    name: 'bare scoped package then count',
    text: 'In CI, @acme/web tests pass: 97.',
    predicate: 'tests.passed',
    subject: GH,
    params: P97,
    expected: 'no-witness',
    note: 'scoped package name with no pattern',
    red: true,
  },
  {
    name: 'tests in the web directory',
    text: 'CI ran the tests in the web directory: 97 passed.',
    predicate: 'tests.passed',
    subject: GH,
    params: P97,
    expected: 'no-witness',
    note: "'tests in' pattern needs a slash or scoped name",
    red: true,
  },
  {
    name: 'tests for a bare module name',
    text: 'CI shows the tests for billing pass: 97.',
    predicate: 'tests.passed',
    subject: GH,
    params: P97,
    expected: 'no-witness',
    note: "'tests for' pattern needs a slash",
    red: true,
  },
  {
    name: 'within a path',
    text: 'Within apps/web, CI shows 97 tests passing.',
    predicate: 'tests.passed',
    subject: GH,
    params: P97,
    expected: 'no-witness',
    note: "'within <path>' is not a pattern",
    red: true,
  },
  {
    name: 'module and workspace words',
    text: 'The payments module tests pass in CI: 97.',
    predicate: 'tests.passed',
    subject: GH,
    params: P97,
    expected: 'no-witness',
    note: "'module' is not in the package/spec words",
    red: true,
  },
  {
    name: 'workspace word',
    text: 'CI shows the web workspace passing: 97 tests.',
    predicate: 'tests.passed',
    subject: GH,
    params: P97,
    expected: 'no-witness',
    note: "'workspace' is not in the package/spec words",
    red: true,
  },
  {
    name: 'typecheck in CI, no job word, red run',
    text: 'Typecheck is green in CI.',
    predicate: 'ci.passed',
    subject: GH,
    expected: 'no-witness',
    note: 'judgment: a named check without the word job/check/step reaches the run conclusion',
    red: true,
  },
  {
    name: 'job on tests.passed',
    text: 'The e2e job ran 97 tests in CI and they passed.',
    predicate: 'tests.passed',
    subject: GH,
    params: P97,
    expected: 'no-witness',
    note: 'jobOf is applied only to ci.passed',
    red: true,
  },
  {
    name: 'branch named only in the sentence',
    text: 'All 640 tests pass on main.',
    predicate: 'tests.passed',
    subject: GH,
    params: P640,
    expected: 'no-witness',
    note: 'judgment: CI ran fix/invoices; branch in prose, not resource',
  },
  {
    name: 'a different PR number as resource',
    text: 'PR #999 is green.',
    predicate: 'ci.passed',
    subject: { system: 'github', resource: '#999' },
    expected: 'no-witness',
    note: 'any number counts as a whole-repo ref, not checked against the run',
  },
  {
    name: 'the base commit as resource',
    text: 'CI is green on a1b2c3d.',
    predicate: 'ci.passed',
    subject: { system: 'github', resource: 'a1b2c3d' },
    expected: 'no-witness',
    note: "any sha counts as whole-repo; this is the session's base, not the run's commit",
  },
  {
    name: 'a different run id as resource',
    text: 'Run 9999 passed.',
    predicate: 'ci.passed',
    subject: { system: 'github', resource: 'acme-demo/billing-api/actions/runs/9999' },
    expected: 'no-witness',
    note: 'any run path counts as whole-repo; the witness saw run 5101',
  },
  {
    name: 'a different PR as pull/N',
    text: 'CI on pull 999 is green.',
    predicate: 'ci.passed',
    subject: { system: 'github', resource: 'pull/999' },
    expected: 'no-witness',
    note: 'any PR number counts',
  },
];

const wholeRefused: Case[] = [
  {
    name: 'every required check',
    text: 'Every required check passed in CI.',
    predicate: 'ci.passed',
    subject: GH,
    expected: 'holds',
    note: "JOB regex reads 'required check' as a job named required",
  },
  {
    name: 'status checks',
    text: 'All status check results are green in CI.',
    predicate: 'ci.passed',
    subject: GH,
    expected: 'holds',
    note: "JOB regex reads 'status check' as a job named status",
  },
  {
    name: 'no job failed',
    text: 'No job failed in CI.',
    predicate: 'ci.passed',
    subject: GH,
    expected: 'holds',
    note: "JOB regex reads 'No job' as a job named No",
  },
  {
    name: 'operation status',
    text: 'CI is green.',
    predicate: 'ci.passed',
    subject: { system: 'github', operation: 'status' },
    expected: 'holds',
    note: 'operation status is treated as a job name',
  },
  {
    name: 'operation completed',
    text: 'The CI run completed green.',
    predicate: 'ci.passed',
    subject: { system: 'github', operation: 'completed' },
    expected: 'holds',
    note: 'operation completed is treated as a job name',
  },
  {
    name: 'all three packages',
    text: 'CI is green for both packages.',
    predicate: 'ci.passed',
    subject: GH,
    expected: 'holds',
    note: "'both packages' read as a package named both",
  },
  {
    name: 'the three packages',
    text: 'CI passes all 640 tests across the three packages.',
    predicate: 'tests.passed',
    subject: GH,
    params: P640,
    expected: 'holds',
    note: "'three packages' read as a package named three",
  },
  {
    name: 'pnpm -w run in CI',
    text: 'In CI, `pnpm -w run test` passed: 640 tests.',
    predicate: 'tests.passed',
    subject: GH,
    params: P640,
    expected: 'holds',
    note: "-w is the workspace root; the value 'run' is read as a scope",
  },
  {
    name: 'yarn workspaces foreach',
    text: 'CI ran `yarn workspaces foreach run test`: 640 passed.',
    predicate: 'tests.passed',
    subject: GH,
    params: P640,
    expected: 'holds',
    note: "'yarn workspaces' is every workspace",
  },
  {
    name: 'origin/ branch resource',
    text: 'CI is green on origin/fix/invoices.',
    predicate: 'ci.passed',
    subject: { system: 'github', resource: 'origin/fix/invoices' },
    expected: 'holds',
    note: 'origin/ prefix is no longer stripped',
  },
  {
    name: 'the push resource shape',
    text: 'CI is green on the pushed branch.',
    predicate: 'ci.passed',
    subject: { system: 'github', resource: 'acme-demo/billing-api@refs/heads/fix/invoices' },
    expected: 'holds',
    note: "the witness's own push resource shape",
  },
  {
    name: 'clone URL with .git',
    text: 'CI is green on the clone.',
    predicate: 'ci.passed',
    subject: { system: 'github', resource: 'https://github.com/acme-demo/billing-api.git' },
    expected: 'holds',
    note: '.git suffix on the repository URL',
  },
  {
    name: 'whole repo and all packages',
    text: 'CI passed for the whole repo.',
    predicate: 'ci.passed',
    subject: { system: 'github', resource: 'whole repo' },
    expected: 'holds',
    note: "'whole' is not stripped",
  },
  {
    name: 'resource all packages',
    text: 'CI passed for all packages.',
    predicate: 'ci.passed',
    subject: { system: 'github', resource: 'all packages' },
    expected: 'holds',
    note: 'all packages is every package',
  },
  {
    name: 'resource checks',
    text: 'The CI checks are green.',
    predicate: 'ci.passed',
    subject: { system: 'github', resource: 'checks' },
    expected: 'holds',
    note: 'whole-run word not in WHOLE',
  },
  {
    name: 'sha prefix word',
    text: 'CI is green on the session commit.',
    predicate: 'ci.passed',
    subject: { system: 'github', resource: 'sha b7d4e90' },
    expected: 'holds',
    note: "'sha <hex>' is not stripped",
  },
  {
    name: 'workflow with spaces and suffix',
    text: 'The Build and Test workflow passed.',
    predicate: 'ci.passed',
    subject: { system: 'github', resource: 'Build and Test workflow' },
    expected: 'holds',
    note: 'control: workflow name with spaces',
    workflow: 'Build and Test',
  },
  {
    name: 'workflow that did not run',
    text: 'The release workflow passed.',
    predicate: 'ci.passed',
    subject: { system: 'github', resource: 'release workflow' },
    expected: 'no-witness',
    note: 'control: CI only ran the ci workflow',
  },
  {
    name: 'main branch when CI ran main',
    text: 'CI is green on main.',
    predicate: 'ci.passed',
    subject: { system: 'github', resource: 'main' },
    expected: 'holds',
    note: 'control: CI ran main',
    branch: 'main',
  },
];

export const skepticP641b: AdversarialFixture[] = [
  ...localSlips,
  ...ciDidOverrides,
  ...localWrongRefusals,
  ...scopeSlips,
  ...wholeRefused,
].map(make);
