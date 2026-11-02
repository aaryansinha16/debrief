import { describe, expect, it } from 'vitest';

import { claim, ist, testReport, workflowRun, SHA_B } from './__fixtures__/index.js';
import { claimsOf } from './claims.js';
import { isLocalRun, narrowScope, reposOf } from './scope.js';
import type { ClaimRecord } from './types.js';

const said = (text: string, subject: Parameters<typeof claim>[0]['subject']): ClaimRecord =>
  claimsOf([claim({ n: 1, at: ist('14:27:40'), text, predicate: 'tests.passed', subject })])[0]!;
const gh = { system: 'github' };
const run = workflowRun({ n: 2, at: ist('14:27:20'), sha: SHA_B, runId: 7, workflow: 'build' });
const ci = [run];

describe('isLocalRun', () => {
  it('reads a local tool as the subject, or a command the agent ran without naming CI', () => {
    expect(isLocalRun(said('Both green.', { system: 'PNPM' }))).toBe(true);
    expect(isLocalRun(said('`pnpm --filter web test` passed.', gh))).toBe(true);
    expect(isLocalRun(said('Lint passed locally.', gh))).toBe(true);
    expect(isLocalRun(said('Tests pass in my worktree.', gh))).toBe(true);
    expect(isLocalRun(said('CI ran `pnpm test` and it passed.', gh))).toBe(false);
    expect(isLocalRun(said('`pnpm test` passed in run #7.', gh))).toBe(false);
    expect(isLocalRun(said('All 142 tests pass.', gh))).toBe(false);
  });
});

describe('narrowScope', () => {
  const scope = (text: string, resource?: string) =>
    narrowScope(said(text, resource === undefined ? gh : { ...gh, resource }), ci);

  it('names a package or path from the subject, a filter flag or the sentence', () => {
    expect(scope('The tests pass.', '@acme/web')).toBe('@acme/web');
    expect(scope('The tests pass.', 'web')).toBe('web');
    expect(scope('`turbo run test -F web` passed in CI.')).toBe('web');
    expect(scope('CI ran --filter=@acme/web and passed.')).toBe('@acme/web');
    expect(scope('CI ran 97 passing tests in web/src.')).toBe('web/src');
    expect(scope('CI says invoice.spec.ts passes.')).toBe('invoice.spec.ts');
  });

  it('answers for the whole repository by name, branch, workflow, PR, commit or a CI word', () => {
    for (const resource of [
      'acme-demo/billing-api',
      'billing-api',
      'acme-demo/billing-api#311',
      'fix/invoices',
      'origin/fix/invoices',
      'refs/heads/fix/invoices',
      'build',
      'PR #311',
      '311',
      'b7d4e90',
      'ci',
      ' ',
    ]) {
      expect(scope('The tests pass.', resource), resource).toBeUndefined();
    }
    expect(scope('CI ran --filter billing-api, all green.')).toBeUndefined();
    expect(
      scope('See https://example.invalid/acme-demo/billing-api/pull/311 for 142 passes.'),
    ).toBe(undefined);
    expect(scope('640 tests pass on fix/invoices.')).toBeUndefined();
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
