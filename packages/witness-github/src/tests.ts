import type { TestCounts } from './junit.js';
import type { TestSource } from './map.js';

export interface TestReport {
  source: TestSource;
  reporter?: string;
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

// Reports of one kind (JUnit, or one reporter) add up; every kind present must agree or none is believed.
export function resolveTests(reports: readonly TestReport[]): TestResolution | undefined {
  const kinds = new Map<string, { source: TestSource; reports: TestReport[] }>();
  for (const report of reports) {
    const key = report.reporter ?? report.source;
    const kind = kinds.get(key) ?? { source: report.source, reports: [] };
    kind.reports.push(report);
    kinds.set(key, kind);
  }
  const sums = [...kinds].map(([key, kind]) => ({
    key,
    source: kind.source,
    counts: sum(kind.reports),
  }));
  const [first, ...others] = sums;
  if (first === undefined) return undefined;
  const odd = others.find((other) => text(other.counts) !== text(first.counts));
  if (odd !== undefined) {
    return {
      ok: false,
      reason: `${first.key} says ${text(first.counts)} and ${odd.key} says ${text(odd.counts)} (passed/failed/skipped)`,
    };
  }
  if (total(first.counts) === 0) return { ok: false, reason: 'the report holds no tests' };
  return { ok: true, source: first.source, counts: first.counts };
}
