import type { Event } from '@debrief/schema';

import { num, str } from '../select.js';
import type { Checker, Finding } from '../types.js';
import { isRun, isTestReport, noWitness, runLabel, selectCi } from './ci.js';

interface Counts {
  passed: number;
  failed: number;
  skipped: number;
}

interface Report {
  event: Event;
  counts: Counts;
}

function reportOf(event: Event): Report | undefined {
  const passed = num(event.attrs, 'world.tests.passed');
  const failed = num(event.attrs, 'world.tests.failed');
  const skipped = num(event.attrs, 'world.tests.skipped');
  return passed === undefined || failed === undefined || skipped === undefined
    ? undefined
    : { event, counts: { passed, failed, skipped } };
}

const text = (c: Counts): string =>
  `${String(c.passed)} passed, ${String(c.failed)} failed, ${String(c.skipped)} skipped`;

const describe = (reports: readonly Report[]): string =>
  reports.map((r) => `${runLabel(r.event)}: ${text(r.counts)}`).join('; ');

const events = (reports: readonly Report[]): Event[] => reports.map((r) => r.event);

const sum = (all: readonly Report[]): Counts => ({
  passed: all.reduce((n, r) => n + r.counts.passed, 0),
  failed: all.reduce((n, r) => n + r.counts.failed, 0),
  skipped: all.reduce((n, r) => n + r.counts.skipped, 0),
});

// The claim's numbers, when it gave any, must all agree with the report; "tests pass" alone needs zero failures.
function agrees(claim: Record<string, string | number>, counts: Counts): boolean {
  const want = (name: string): number | undefined =>
    typeof claim[name] === 'number' ? claim[name] : undefined;
  const total = counts.passed + counts.failed + counts.skipped;
  const checks: [number | undefined, number][] = [
    [want('passed'), counts.passed],
    [want('failed') ?? 0, counts.failed],
    [want('skipped'), counts.skipped],
    [want('total'), total],
  ];
  return checks.every(([wanted, got]) => wanted === undefined || wanted === got);
}

// Two reports for one attempt that disagree settle nothing (ARCHITECTURE §18.4).
function conflicting(reports: readonly Report[]): { label: string; reports: Report[] } | undefined {
  const byAttempt = new Map<string, { counts: string; reports: Report[] }>();
  for (const report of reports) {
    const { attrs } = report.event;
    const runId = num(attrs, 'github.run_id');
    if (runId === undefined) continue;
    const key = `${String(runId)}:${String(num(attrs, 'github.run_attempt'))}`;
    const counts = text(report.counts);
    const current = byAttempt.get(key);
    if (current === undefined) byAttempt.set(key, { counts, reports: [report] });
    else if (current.counts !== counts) {
      return { label: runLabel(report.event), reports: [...current.reports, report] };
    } else current.reports.push(report);
  }
  return undefined;
}

// "3 failed out of 142" read as 3 passed: a sentence about failures with no failed count was misread and is not scored.
const MENTIONS_FAILURE = /\bfail(?:s|ed|ing|ure|ures)?\b/i;
const SAYS_ALL = /\b(?:all|every)\b/i;

export const testsPassed: Checker = (claim, ctx): Finding => {
  if (MENTIONS_FAILURE.test(claim.text) && typeof claim.params.failed !== 'number') {
    return noWitness(
      'the sentence speaks of failures but the claim carries no failed count, so its numbers are not trusted',
    );
  }
  const selected = selectCi(claim, ctx, (e) => isRun(e) || isTestReport(e));
  if (selected.missing !== undefined) return selected.missing;
  const reports = selected.events
    .filter(isTestReport)
    .map(reportOf)
    .filter(
      (r): r is Report =>
        r !== undefined && r.counts.passed + r.counts.failed + r.counts.skipped > 0,
    );
  const runs = selected.events.filter(isRun);
  if (reports.length === 0) {
    const failed = runs.filter((run) => (num(run.attrs, 'ci.jobs.failed') ?? 0) > 0);
    if (failed.length > 0) {
      return {
        outcome: 'contradicted',
        evidence: failed,
        reason: failed
          .map((run) => `${runLabel(run)}: ${String(num(run.attrs, 'ci.jobs.failed'))} jobs failed`)
          .join('; '),
      };
    }
    const empty = selected.events.filter(isTestReport);
    return noWitness(
      empty.length > 0
        ? `the test report for ${empty.map(runLabel).join(', ')} holds no tests`
        : `no test report for ${runs.map(runLabel).join(', ')}; job counts are not test counts (D-085), connect the CI test witness`,
    );
  }
  const conflict = conflicting(reports);
  if (conflict !== undefined) {
    const counts = conflict.reports.map((r) => text(r.counts)).join(' vs ');
    return noWitness(
      `conflicting test counts for ${conflict.label}: ${counts}`,
      events(conflict.reports),
    );
  }
  // A failure on the session's commit contradicts "tests pass" unless the claim owned up to that count.
  const failing =
    typeof claim.params.failed === 'number' ? [] : reports.filter((r) => r.counts.failed > 0);
  if (failing.length > 0) {
    return { outcome: 'contradicted', evidence: events(failing), reason: describe(failing) };
  }
  const single = reports.filter((r) => agrees(claim.params, r.counts));
  const matching = single.length > 0 ? single : agrees(claim.params, sum(reports)) ? reports : [];
  if (matching.length > 0) {
    // "All tests pass" over a report with skips is not what the report shows, unless the claim counted them.
    const skipped = matching.filter((r) => r.counts.skipped > 0);
    if (
      SAYS_ALL.test(claim.text) &&
      typeof claim.params.skipped !== 'number' &&
      skipped.length > 0
    ) {
      return noWitness(
        `the claim says all, but ${skipped.map((r) => `${runLabel(r.event)} skipped ${String(r.counts.skipped)} tests`).join('; ')}`,
        events(skipped),
      );
    }
    const green = (r: Report): boolean => str(r.event.attrs, 'ci.conclusion') === 'success';
    const concluded =
      single.length > 0 ? matching.filter(green) : matching.every(green) ? matching : [];
    if (concluded.length > 0) {
      return { outcome: 'holds', evidence: events(concluded), reason: describe(concluded) };
    }
    const concluded_ = matching
      .filter((r) => !green(r))
      .map(
        (r) => `${runLabel(r.event)} concluded ${str(r.event.attrs, 'ci.conclusion') ?? 'unknown'}`,
      )
      .join(', ');
    return noWitness(`the counts match but ${concluded_}`, events(matching));
  }
  const said = Object.entries(claim.params)
    .map(([name, value]) => `${String(value)} ${name}`)
    .join(', ');
  return {
    outcome: 'contradicted',
    evidence: events(reports),
    reason: `${describe(reports)}; the claim says ${said}`,
  };
};
