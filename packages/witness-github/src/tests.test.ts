import { describe, expect, it } from 'vitest';

import { JUNIT_COUNTS, JUNIT_FILES, rest } from './__fixtures__/index.js';
import {
  countCheckOutput,
  countJunit,
  resolveTests,
  type TestReport,
  workflowRunSchema,
} from './index.js';

const failing = workflowRunSchema.parse(rest.runs[0]);
const junit = (): TestReport[] =>
  Object.values(JUNIT_FILES).map((xml) => ({ source: 'junit', counts: countJunit(xml) }));
const reporter = (): TestReport[] => {
  const check = rest.checkRunsBySha[failing.head_sha]?.check_runs[0];
  const found = countCheckOutput(check as never);
  return found === undefined ? [] : [{ source: 'check-run', counts: found.counts }];
};

describe('test counts on a run', () => {
  it('adds up the files of one source to the exact counts', () => {
    expect(resolveTests(junit())).toEqual({ ok: true, source: 'junit', counts: JUNIT_COUNTS });
  });

  it('reads the reporter check run as the same counts', () => {
    expect(resolveTests(reporter())).toEqual({
      ok: true,
      source: 'check-run',
      counts: JUNIT_COUNTS,
    });
    expect(resolveTests([...junit(), ...reporter()])).toMatchObject({ ok: true, source: 'junit' });
  });

  it('treats each reporter as its own source rather than adding them up', () => {
    const [report] = reporter();
    const a: TestReport = { ...report!, reporter: 'publish-unit-test-result' };
    const b: TestReport = { ...report!, reporter: 'test-reporter' };
    expect(resolveTests([a, b])).toEqual({ ok: true, source: 'check-run', counts: JUNIT_COUNTS });
    const two: TestReport = { ...b, counts: { passed: 1, failed: 0, skipped: 0 } };
    expect(JSON.stringify(resolveTests([a, two]))).toContain('publish-unit-test-result says');
    expect(resolveTests([a, a])).toMatchObject({ counts: { passed: 30 } });
  });

  it('posts nothing when there is no report, and refuses when sources disagree or are empty', () => {
    expect(resolveTests([])).toBeUndefined();
    const other: TestReport = { source: 'check-run', counts: { passed: 1, failed: 0, skipped: 0 } };
    const split = resolveTests([...junit(), other]);
    expect(split?.ok).toBe(false);
    expect(JSON.stringify(split)).toContain('junit says 15/2/2 and check-run says 1/0/0');
    const empty: TestReport = { source: 'junit', counts: { passed: 0, failed: 0, skipped: 0 } };
    expect(resolveTests([empty])).toEqual({ ok: false, reason: 'the report holds no tests' });
  });
});
