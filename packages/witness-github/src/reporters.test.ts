import { describe, expect, it } from 'vitest';

import { TestReportError } from './junit.js';
import type { CheckRun } from './payloads.js';
import { countCheckOutput } from './reporters.js';

const SYMBOLS = '[symbols](https://example.test/readme#the-symbols)';

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

const published = (title: string) => check({ title, summary: `19 tests ${SYMBOLS}` });

const badge = (segment: string): string =>
  `![Tests failed](https://img.shields.io/badge/tests-${segment}-critical)\n\n|Report|Passed|`;

describe('countCheckOutput', () => {
  it.each([
    ['All 12 tests pass in 3s', { passed: 12, failed: 0, skipped: 0 }],
    ['All 1 test pass in 1s', { passed: 1, failed: 0, skipped: 0 }],
    ['1 errors, 2 fail, 3 skipped, 134 pass in 2m 3s', { passed: 134, failed: 3, skipped: 3 }],
    ['2 fail, 7 pass in 4s', { passed: 7, failed: 2, skipped: 0 }],
  ])('reads publish-unit-test-result title "%s"', (title, counts) => {
    expect(countCheckOutput(published(title))).toEqual({
      reporter: 'publish-unit-test-result',
      counts,
    });
  });

  it.each([
    ['no duration', '2 fail, 7 pass'],
    ['no pass count', '4 skipped in 1s'],
    ['a repeated part', '2 fail, 3 fail, 7 pass in 1s'],
    ['an unknown part', '2 flaky, 7 pass in 1s'],
    ['a singular error', '1 error, 7 pass in 1s'],
  ])('refuses a publish-unit-test-result title with %s', (_name, title) => {
    expect(() => countCheckOutput(published(title))).toThrow(TestReportError);
  });

  it('ignores a title that only looks like the reporter, without its marker', () => {
    expect(countCheckOutput(check({ title: '3 errors', summary: 'lint' }))).toBeUndefined();
    expect(countCheckOutput(check({ title: '0 errors', summary: null }))).toBeUndefined();
    expect(countCheckOutput(check({ title: '2 fail, 7 pass in 1s' }))).toBeUndefined();
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
    expect(() =>
      countCheckOutput(check({ summary: badge('15%20passed%2C%2015%20passed') })),
    ).toThrow(/repeats passed/);
  });

  it.each([
    ['a job check run', check(null)],
    ['an empty title', check({ title: '', summary: null })],
    ['an unknown title', check({ title: 'lint finished', summary: 'ok' })],
    ['another app', check({ title: 'All 3 tests pass in 1s' }, { app: { slug: 'other-ci' } })],
    ['no app', check({ title: 'All 3 tests pass in 1s' }, { app: null })],
    ['an unfinished check', check({ title: 'All 3 tests pass in 1s' }, { status: 'in_progress' })],
  ])('does not treat %s as a report', (_name, run) => {
    expect(countCheckOutput(run)).toBeUndefined();
  });
});
