import type { CheckRun } from './payloads.js';
import { type TestCounts, TestReportError } from './junit.js';

export interface ReporterCounts {
  reporter: string;
  counts: TestCounts;
}

const REPORTER_APP = 'github-actions';
const ALL_PASS = /^All (\d+) tests? pass(?: in .+)?$/;
const TITLE_PART = /^(\d+) (errors?|fail|skipped|pass)$/;
const TEST_REPORTER_BADGE = /img\.shields\.io\/badge\/tests-([^-)\s]+)-/;
const BADGE_PART = /^(\d+) (passed|failed|skipped)$/;

const num = (text: string | undefined): number => Number(text);

function publishUnitTestResult(title: string): TestCounts | undefined {
  const all = ALL_PASS.exec(title);
  if (all) return { passed: num(all[1]), failed: 0, skipped: 0 };
  const counts: TestCounts = { passed: 0, failed: 0, skipped: 0 };
  const parts = title.replace(/ in .+$/, '').split(', ');
  for (const part of parts) {
    const found = TITLE_PART.exec(part);
    if (found === null) return undefined;
    const kind = found[2] === 'pass' ? 'passed' : found[2] === 'skipped' ? 'skipped' : 'failed';
    counts[kind] += Number(found[1]);
  }
  return counts;
}

function testReporter(summary: string): TestCounts | undefined {
  const badge = TEST_REPORTER_BADGE.exec(summary)?.[1];
  if (badge === undefined) return undefined;
  const counts: TestCounts = { passed: 0, failed: 0, skipped: 0 };
  let parts: string[];
  try {
    parts = decodeURIComponent(badge).split(', ');
  } catch {
    throw new TestReportError('test-reporter badge is not decodable');
  }
  for (const part of parts) {
    const found = BADGE_PART.exec(part);
    if (found === null) throw new TestReportError(`test-reporter badge part "${part}" unknown`);
    counts[found[2] as keyof TestCounts] += Number(found[1]);
  }
  return counts;
}

// A closed list of reporters, each recognised by its own output shape; anything else is not a report.
// An error is counted as a failure, as the JUnit counter does.
export function countCheckOutput(check: CheckRun): ReporterCounts | undefined {
  if (check.status !== 'completed' || check.app?.slug !== REPORTER_APP) return undefined;
  const title = check.output?.title ?? '';
  const summary = check.output?.summary ?? '';
  const published = publishUnitTestResult(title);
  if (published) return { reporter: 'publish-unit-test-result', counts: published };
  const reported = testReporter(summary);
  return reported && { reporter: 'test-reporter', counts: reported };
}
