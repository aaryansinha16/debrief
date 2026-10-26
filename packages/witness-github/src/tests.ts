import type { TestCounts } from './junit.js';
import type { TestSource } from './map.js';

export interface TestReport {
  source: TestSource;
  counts: TestCounts;
}

export type TestResolution =
  { ok: true; source: TestSource; counts: TestCounts } | { ok: false; reason: string };

const total = (counts: TestCounts): number => counts.passed + counts.failed + counts.skipped;
const text = (counts: TestCounts): string =>
  `${String(counts.passed)}/${String(counts.failed)}/${String(counts.skipped)}`;

function sum(reports: readonly TestReport[]): TestCounts {
  const counts: TestCounts = { passed: 0, failed: 0, skipped: 0 };
  for (const report of reports) {
    counts.passed += report.counts.passed;
    counts.failed += report.counts.failed;
    counts.skipped += report.counts.skipped;
  }
  return counts;
}

// Reports of one source add up (one per package); two sources must agree or neither is believed.
export function resolveTests(reports: readonly TestReport[]): TestResolution | undefined {
  const sources = (['junit', 'check-run'] as const).flatMap((source) => {
    const own = reports.filter((report) => report.source === source);
    return own.length === 0 ? [] : [{ source, counts: sum(own) }];
  });
  const [first, second] = sources;
  if (first === undefined) return undefined;
  if (second !== undefined && text(first.counts) !== text(second.counts)) {
    return {
      ok: false,
      reason: `${first.source} says ${text(first.counts)} and ${second.source} says ${text(second.counts)} (passed/failed/skipped)`,
    };
  }
  if (total(first.counts) === 0) return { ok: false, reason: 'the report holds no tests' };
  return { ok: true, source: first.source, counts: first.counts };
}
