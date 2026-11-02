import { describe, expect, it } from 'vitest';

import { SHA_B, claim, ist, prOpened, testReport, workflowRun } from './__fixtures__/index.js';
import { claimsOf } from './claims.js';
import { jobOf, reposOf, scopeMismatch } from './scope.js';
import type { ClaimRecord } from './types.js';

type Subject = Parameters<typeof claim>[0]['subject'];
const said = (
  text: string,
  subject: Subject = { system: 'github' },
  params: Record<string, string | number> = {},
): ClaimRecord =>
  claimsOf([
    claim({ n: 1, at: ist('14:27:40'), text, predicate: 'tests.passed', subject, params }),
  ])[0]!;
const run = workflowRun({ n: 2, at: ist('14:27:20'), sha: SHA_B, runId: 7, workflow: 'build' });
const ci = [run];
const observed = [run, prOpened(3, ist('14:26:30'), 311, SHA_B)];

describe('scopeMismatch', () => {
  const scope = (text: string, resource?: string, params?: Record<string, string | number>) =>
    scopeMismatch(
      said(text, resource === undefined ? undefined : { system: 'github', resource }, params),
      ci,
      observed,
    );

  it.each<[string, string | undefined, string, Record<string, string | number>?]>([
    ['The tests pass.', '@acme/web', '@acme/web'],
    ['The tests pass.', 'web', 'web'],
    ['The tests pass.', './apps/web', './apps/web'],
    ['The tests pass.', 'invoice.spec.ts', 'invoice.spec.ts'],
    ['The tests pass.', 'acme-demo/ledger-core', 'acme-demo/ledger-core'],
    ['CI ran turbo test --filter=billing-api --filter=web: 97 passed.', undefined, 'web'],
    ['CI ran the web tests (-Fweb): 97 passed.', undefined, 'web'],
    ['CI ran --filter={./apps/web}: green.', undefined, './apps/web'],
    ['yarn workspace web test passed in CI.', undefined, 'web'],
    ['CI ran nx run web:test: green.', undefined, 'web'],
    ['CI ran cd web && pnpm test: green.', undefined, 'web'],
    ['CI ran `vitest run -t "rounding"`: 4 passed.', undefined, 'rounding'],
    ['CI: tests in web/ pass, 97 of them.', undefined, 'web/'],
    ['CI ran the tests under packages/web/** and 97 passed.', undefined, 'packages/web/**'],
    ['The web package tests pass in CI.', undefined, 'web'],
    ['CI shows the @acme/* packages pass.', undefined, '@acme/*'],
    ['The invoice spec passes in CI.', undefined, 'invoice'],
    ['The tests pass.', undefined, 'shared', { scope: 'shared' }],
    ['In CI, @acme/web tests pass: 97.', undefined, '@acme/web'],
    ['CI: apps/web 97 tests passed.', undefined, 'apps/web'],
    ['CI ran the tests in the web directory: 97 passed.', undefined, 'web'],
    ['CI: 97 pass in web/src/**/*.test.ts.', undefined, 'web/src/**/*.test.ts'],
    ['The tests pass.', 'acme-demo/billing-api/packages/web', 'acme-demo/billing-api/packages/web'],
    ['The tests pass.', 'release.yml', 'release.yml'],
  ])('%j narrows to %s', (text, resource, name, params?) => {
    expect(scope(text, resource, params)).toBe(
      `evidence covers the whole of acme-demo/billing-api, not ${name}`,
    );
  });

  it('binds a commit, run or PR to the one CI ran, or says which it ran', () => {
    expect(scope('The tests pass.', 'deadbeef')).toBe('CI ran on b7d4e90, not deadbeef');
    expect(scope('The tests pass.', 'run 9999')).toBe('evidence covers run #7, not run #9999');
    expect(scope('The tests pass.', 'acme-demo/billing-api/actions/runs/7/attempts/2')).toBe(
      undefined,
    );
    expect(scope('The job passed.', 'acme-demo/billing-api/actions/runs/7/job/987')).toBe(
      'evidence covers whole runs of acme-demo/billing-api, not job 987',
    );
    expect(scope('The tests pass.', 'acme-demo/ledger@refs/heads/main')).toBe(
      'evidence covers the whole of acme-demo/billing-api, not acme-demo/ledger@refs/heads/main',
    );
    expect(scope('The tests pass.', 'acme-demo/billing-api/actions/runs/9999')).toBe(
      'evidence covers run #7, not run #9999',
    );
    expect(scope('PR #999 is green.', '#999')).toBe('no witness ties PR #999 to the commit CI ran');
    expect(scope('The tests pass.', 'acme-demo/billing-api/tree/fix/invoices')).toBeUndefined();
    expect(scope('All 640 tests pass on main.')).toBe('CI ran on fix/invoices, not main');
  });

  it('says CI ran on another branch when the claim names a main branch', () => {
    expect(scope('Tests pass on main.', 'main')).toBe('CI ran on fix/invoices, not main');
    const { 'vcs.ref': _ref, ...unbranched } = run.attrs;
    expect(
      scopeMismatch(said('Tests pass on main.', { system: 'github', resource: 'main' }), [
        { ...run, attrs: unbranched },
      ]),
    ).toBe('evidence covers the whole of acme-demo/billing-api, not main');
  });

  it.each([
    'acme-demo/billing-api',
    'billing-api',
    'billing api',
    'acme-demo/billing-api#311',
    'acme-demo/billing-api@refs/heads/fix/invoices',
    'acme-demo/billing-api/actions/runs/7',
    'https://github.com/acme-demo/billing-api',
    'github.com/acme-demo/billing-api/pull/311',
    'fix/invoices',
    'fix/invoices.',
    'branch fix/invoices',
    'origin',
    'refs/heads/fix/invoices',
    'refs/pull/311/merge',
    'pull/311',
    'pull request 311',
    'PR #311',
    'commit b7d4e90',
    'HEAD',
    'build',
    'ci.yml',
    '.github/workflows/ci.yml',
    'CI workflow',
    'the repo',
    'monorepo',
    'test suite',
    'all tests',
    ' ',
  ])('treats the resource %j as the whole repository', (resource) => {
    expect(scope('The tests pass.', resource)).toBeUndefined();
  });

  it.each([
    'CI: 640/640 tests pass.',
    'The CI/CD pipeline is green.',
    'CI green: lint/typecheck/test all passed.',
    'CI passed with 640 tests on ubuntu-latest/node-20.',
    'CI is green after bumping actions/checkout@v4.',
    'See github.com/acme-demo/billing-api/actions/runs/5101: green.',
    'All 640 tests pass on Node.js 20 in CI.',
    'CI is green after my change to src/billing/invoice.ts.',
    'CI ran --filter billing-api, all green.',
    'CI is green after bumping @acme/shared to 2.1.',
    'CI is green after the fix in packages/verdict/src/scope.ts.',
    'All 640 tests pass in CI/CD.',
    'CI passed for all packages: 640 tests.',
    '640 tests in 54 files pass in CI.',
  ])('reads %j as about the whole repository', (text) => {
    expect(scope(text)).toBeUndefined();
  });
});

describe('jobOf', () => {
  const job = (text: string, operation?: string, params?: Record<string, string | number>) =>
    jobOf(
      said(text, operation === undefined ? undefined : { system: 'github', operation }, params),
    );

  it('names the job a claim is about, from the extractor, its operation or the sentence', () => {
    expect(job('CI is green.', undefined, { job: 'deploy' })).toBe('deploy');
    expect(job('Lint passed in CI.', 'lint')).toBe('lint');
    expect(job('The web job passed in CI.')).toBe('web');
    expect(job('The `typecheck` check is green.')).toBe('typecheck');
    expect(job('The test job passed.')).toBe('test');
  });

  it('reads a check word in a ci.passed sentence as a job, unless it is about the whole run', () => {
    const ci = (text: string) =>
      jobOf(
        claimsOf([
          claim({
            n: 1,
            at: ist('14:27:40'),
            text,
            predicate: 'ci.passed',
            subject: { system: 'github' },
          }),
        ])[0]!,
      );
    expect(ci('Typecheck passed in CI.')).toBe('Typecheck');
    expect(ci('CI passed lint and typecheck.')).toBe('lint');
    expect(ci('CI is green, lint included.')).toBeUndefined();
    expect(ci('All checks passed, lint too.')).toBeUndefined();
    expect(ci('All 5 checks passed in CI.')).toBeUndefined();
    expect(ci('PR checks passed in CI.')).toBeUndefined();
  });

  it('reads a run-level claim as no job', () => {
    expect(job('CI is green.', 'ci')).toBeUndefined();
    expect(job('The whole job list passed.')).toBeUndefined();
    expect(job('The lint workflow passed.', undefined, { workflow: 'lint' })).toBeUndefined();
    expect(job('CI is green.')).toBeUndefined();
  });
});

describe('reposOf', () => {
  it('lists each repository once, or says the repository when none is named', () => {
    const report = testReport({ n: 3, at: ist('14:27:21'), sha: SHA_B, runId: 7, passed: 1 });
    expect(reposOf([run, report])).toBe('acme-demo/billing-api');
    const { 'github.repo': _r, ...bare } = run.attrs;
    expect(reposOf([{ ...run, attrs: bare }])).toBe('the repository');
  });
});
