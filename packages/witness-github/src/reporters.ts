import { type TestCounts, TestReportError } from './junit.js';
import type { CheckRun } from './payloads.js';

export interface ReporterCounts {
  reporter: string;
  counts: TestCounts;
}

type Kind = keyof TestCounts;

const REPORTER_APP = 'github-actions';
// The action's summary links its README symbols table; this shape is unverified against a live run.
const PUBLISH_MARKER = '#the-symbols';
const ALL_PASS = /^All (\d+) tests? pass in .+$/;
const TITLE_DURATION = /^(.+) in .+$/;
const TITLE_PART = /^(\d+) (errors|fail|skipped|pass)$/;
const TITLE_KIND: Record<string, Kind> = {
  errors: 'failed',
  fail: 'failed',
  skipped: 'skipped',
  pass: 'passed',
};
const TEST_REPORTER_BADGE = /img\.shields\.io\/badge\/tests-([^-)\s]+)-/;
const BADGE_PART = /^(\d+) (passed|failed|skipped)$/;
const BADGE_KIND: Record<string, Kind> = { passed: 'passed', failed: 'failed', skipped: 'skipped' };

function tally(
  what: string,
  texts: readonly string[],
  pattern: RegExp,
  kinds: Record<string, Kind>,
): TestCounts {
  const counts: TestCounts = { passed: 0, failed: 0, skipped: 0 };
  const seen = new Set<string>();
  for (const text of texts) {
    const found = pattern.exec(text);
    const word = found?.[2] ?? '';
    const kind = kinds[word];
    if (found === null || kind === undefined) {
      throw new TestReportError(`${what} part "${text}" unknown`);
    }
    if (seen.has(word)) throw new TestReportError(`${what} repeats ${word}`);
    seen.add(word);
    counts[kind] += Number(found[1]);
  }
  return counts;
}

function publishUnitTestResult(title: string, summary: string): TestCounts | undefined {
  if (!summary.includes(PUBLISH_MARKER)) return undefined;
  const all = ALL_PASS.exec(title);
  if (all) return { passed: Number(all[1]), failed: 0, skipped: 0 };
  const list = TITLE_DURATION.exec(title)?.[1]?.split(', ');
  const what = 'publish-unit-test-result title';
  if (list === undefined) throw new TestReportError(`${what} has no duration`);
  const counts = tally(what, list, TITLE_PART, TITLE_KIND);
  if (!list.some((part) => part.endsWith(' pass'))) {
    throw new TestReportError(`${what} has no pass count`);
  }
  return counts;
}

function testReporter(summary: string): TestCounts | undefined {
  const badge = TEST_REPORTER_BADGE.exec(summary)?.[1];
  if (badge === undefined) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(badge);
  } catch {
    throw new TestReportError('test-reporter badge is not decodable');
  }
  return tally('test-reporter badge', decoded.split(', '), BADGE_PART, BADGE_KIND);
}

// A closed list of reporters, each recognised by its own output shape; anything else is not a report.
// An error is counted as a failure, as the JUnit counter does.
export function countCheckOutput(check: CheckRun): ReporterCounts | undefined {
  if (check.status !== 'completed' || check.app?.slug !== REPORTER_APP) return undefined;
  const title = check.output?.title ?? '';
  const summary = check.output?.summary ?? '';
  const published = publishUnitTestResult(title, summary);
  if (published) return { reporter: 'publish-unit-test-result', counts: published };
  const reported = testReporter(summary);
  return reported && { reporter: 'test-reporter', counts: reported };
}
