import { describe, expect, it } from 'vitest';

import { TestReportError } from './junit.js';
import type { CheckRun } from './payloads.js';
import { countCheckOutput } from './reporters.js';

const check = (output: CheckRun['output'], overrides: Partial<CheckRun> = {}): CheckRun => ({
  id: 1,
  name: 'Test Results',
  status: 'completed',
  conclusion: 'failure',
  head_sha: 'abc',
  completed_at: '2026-10-20T09:30:12Z',
  app: { slug: 'github-actions' },
  output,
  ...overrides,
});

const badge = (segment: string): string =>
  `![Tests failed](https://img.shields.io/badge/tests-${segment}-critical)\n\n|Report|Passed|`;

describe('countCheckOutput', () => {
  it.each([
    ['All 12 tests pass in 3s', { passed: 12, failed: 0, skipped: 0 }],
    ['All 1 test pass', { passed: 1, failed: 0, skipped: 0 }],
    ['1 errors, 2 fail, 3 skipped, 134 pass in 2m 3s', { passed: 134, failed: 3, skipped: 3 }],
    ['2 fail, 7 pass in 4s', { passed: 7, failed: 2, skipped: 0 }],
    ['4 skipped in 1s', { passed: 0, failed: 0, skipped: 4 }],
  ])('reads publish-unit-test-result title "%s"', (title, counts) => {
    expect(countCheckOutput(check({ title }))).toEqual({
      reporter: 'publish-unit-test-result',
      counts,
    });
  });

  it('reads the test-reporter badge in the summary', () => {
    expect(
      countCheckOutput(check({ title: 'Report', summary: badge('139%20passed%2C%203%20skipped') })),
    ).toEqual({ reporter: 'test-reporter', counts: { passed: 139, failed: 0, skipped: 3 } });
    expect(countCheckOutput(check({ summary: badge('2%20failed') }))?.counts).toEqual({
      passed: 0,
      failed: 2,
      skipped: 0,
    });
  });

  it('refuses a test-reporter badge it cannot read', () => {
    expect(() => countCheckOutput(check({ summary: badge('5%20flaky') }))).toThrow(TestReportError);
    expect(() => countCheckOutput(check({ summary: badge('%E0%A4%A') }))).toThrow(TestReportError);
  });

  it.each([
    ['a job check run', check(null)],
    ['an empty title', check({ title: '', summary: null })],
    ['an unknown title', check({ title: 'lint finished', summary: 'ok' })],
    ['a title with only a duration', check({ title: ' in 4s' })],
    ['another app', check({ title: 'All 3 tests pass' }, { app: { slug: 'other-ci' } })],
    ['no app', check({ title: 'All 3 tests pass' }, { app: null })],
    ['an unfinished check', check({ title: 'All 3 tests pass' }, { status: 'in_progress' })],
  ])('does not treat %s as a report', (_name, run) => {
    expect(countCheckOutput(run)).toBeUndefined();
  });
});
