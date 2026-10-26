import { describe, expect, it } from 'vitest';

import { countJunit, TestReportError } from './junit.js';

const suite = (body: string): string => `<?xml version="1.0"?><testsuites>${body}</testsuites>`;

describe('countJunit', () => {
  it('counts nested suites, a skipped case and an errored case', () => {
    const xml = suite(`
      <!-- <testcase name="commented"/> -->
      <testsuite name="a">
        <testcase name="ok" classname="a"/>
        <testcase name="slow"><system-out><![CDATA[<testcase name="in cdata"/>]]></system-out></testcase>
        <testsuite name="inner">
          <testcase name="boom"><error message="a > b" type="Error">trace</error></testcase>
          <testcase name="bad"><failure message="x"/><skipped/></testcase>
          <testcase name="later"><skipped message="todo"/></testcase>
        </testsuite>
      </testsuite>`);
    expect(countJunit(xml)).toEqual({ passed: 2, failed: 2, skipped: 1 });
  });

  it('reads a bare testsuite root and an empty one', () => {
    expect(countJunit("<testsuite name='s'><testcase name='x'/></testsuite>")).toEqual({
      passed: 1,
      failed: 0,
      skipped: 0,
    });
    expect(countJunit('<testsuite/>')).toEqual({ passed: 0, failed: 0, skipped: 0 });
  });

  it.each([
    ['not xml', 'hello'],
    ['another root', '<report><testcase name="x"/></report>'],
    ['two roots', '<testsuite/><testsuite/>'],
    ['unclosed', '<testsuite><testcase name="x"></testsuite>'],
    ['truncated', '<testsuite><testcase name="x"/>'],
    ['stray <', '<testsuite> < <testcase name="x"/></testsuite>'],
    ['trailing garbage', '<testsuite/><'],
    ['doctype', '<!DOCTYPE x [<!ENTITY a "b">]><testsuite/>'],
    ['nested testcase', '<testsuite><testcase><testcase/></testcase></testsuite>'],
  ])('refuses %s', (_name, xml) => {
    expect(() => countJunit(xml)).toThrow(TestReportError);
  });
});
