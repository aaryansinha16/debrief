import { describe, expect, it } from 'vitest';

import { claim, ist } from './__fixtures__/index.js';
import { claimsOf } from './claims.js';
import { ciAttributed, ciSubject, isLocalRun } from './local.js';
import type { ClaimRecord } from './types.js';

type Subject = Parameters<typeof claim>[0]['subject'];
type Row = [string, Subject?, Record<string, string | number>?];
const said = (
  text: string,
  subject: Subject = { system: 'github' },
  params: Record<string, string | number> = {},
): ClaimRecord =>
  claimsOf([
    claim({ n: 1, at: ist('14:27:40'), text, predicate: 'tests.passed', subject, params }),
  ])[0]!;

describe('isLocalRun', () => {
  it.each<Row>([
    ['Both green.', { system: 'PNPM' }],
    ['`pnpm --filter web test` passed.', undefined],
    ['pnpm test passed: 97 tests.', undefined],
    ['Ran pnpm --dir web test: 97 passed.', undefined],
    ['Lint passed (ran `make lint` before the push to CI).', undefined],
    ['Lint passed locally; CI has not finished yet.', undefined],
    ['Ran the test workflow locally: green.', undefined],
    ['Lint passed on my laptop.', undefined],
    ['Lint passed in the terminal.', undefined],
    ['Tests pass in my worktree.', undefined],
    ['Per the CI config I ran cd web && pnpm test: 97 passed.', undefined],
    ['Same as CI: `pnpm -C web test` passed, 97 tests.', undefined],
    ['In CI terms, `nx test web` passed: 97 tests.', undefined],
    ['CI passed, says the extractor, but it was mine.', { system: 'github' }, { where: 'local' }],
    ['We ran the tests: 97 pass.'],
    ['I just ran the tests and 97 passed.'],
    ['Ran the suite myself: 97 pass.'],
    ['After running vitest, 97 tests pass.'],
    ['Tests pass on my end: 97.'],
    ['Tests pass on localhost: 97.'],
    ['Tests passed here: 97 of them.'],
    ['Tests pass, same as CI: 97.'],
    ['The CI-style run passed: 97 tests.'],
    ['I ran `pnpm test` before CI runs it: 97 passed.'],
    ['Tests pass (CI has not run yet): 97.'],
    ['CI is still running; the tests pass: 97.'],
    ['`pnpm test` passed in CI mode: 97 tests.'],
    ['Ran `go test ./...`: 97 passed.'],
    ['dotnet test passed: 97 tests.'],
    ['make test passed with 97 tests.'],
    ['Ran `node scripts/check.mjs`: green.'],
  ])('reads %j as the agent’s own run', (text, subject, params) => {
    expect(isLocalRun(said(text, subject, params))).toBe(true);
  });

  it.each<Row>([
    ['CI ran `pnpm test` and 640 tests passed.', { system: 'pnpm' }],
    ['The CI run is green, tsc included.', { system: 'tsc' }],
    ['All 640 tests pass.', undefined],
    ['640 tests pass, including the local-first sync suite.', undefined],
    ['CI passed 640 tests, which use a local database.', undefined],
    ['640 tests pass on `node 20` after the change.', undefined],
    ['Make sure the suite is green: 640 pass.', undefined],
    ['pnpm said nothing; the suite is green.', { system: 'pnpm' }, { where: 'ci' }],
    ['I ran into a flaky test earlier, but all 640 tests pass on the PR.'],
    ['All 640 tests pass; next I will yarn install the new lockfile.'],
    ['CI reused the local build cache and all 640 tests passed.'],
    ['CI is still green: 640 tests pass.'],
    ['CI still passes: 640 tests.'],
    ['CI passed after running 640 tests.'],
  ])('reads %j as CI’s', (text, subject, params) => {
    expect(isLocalRun(said(text, subject, params))).toBe(false);
  });

  it('lets the sentence or the extractor attribute a run to CI, and reads CI for it', () => {
    expect(ciSubject(said('CI ran `pnpm test`: green.', { system: 'pnpm' })).subject.system).toBe(
      'ci',
    );
    expect(ciSubject(said('pnpm test: green.', { system: 'pnpm' })).subject.system).toBe('pnpm');
    expect(ciSubject(said('Tests passed in CI: 97.', { system: 'gitlab' })).subject.system).toBe(
      'gitlab',
    );
    expect(ciAttributed(said('Lint passed in CI.'))).toBe(true);
    expect(ciAttributed(said('All 640 tests pass.'))).toBe(false);
    expect(ciAttributed(said('Lint passed in CI.', undefined, { where: 'local' }))).toBe(false);
  });
});
