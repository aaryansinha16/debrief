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
    [
      'a testcase hidden in system-out',
      '<testsuite><testcase><failure/><system-out><testcase/></system-out></testcase></testsuite>',
    ],
    [
      'markup inside an attribute value',
      '<testsuite><testcase name="<![CDATA["/><testcase><failure/></testcase><testcase name="]]>"/></testsuite>',
    ],
    ['unterminated comment', '<testsuite><!-- <testcase/></testsuite>'],
    ['unterminated CDATA', '<testsuite><![CDATA[ </testsuite>'],
    ['unterminated PI', '<testsuite><?x </testsuite>'],
  ])('refuses %s', (_name, xml) => {
    expect(() => countJunit(xml)).toThrow(TestReportError);
  });

  it.each([
    ['unterminated tags', '<testsuite>' + '<a'.repeat(500_000)],
    ['unterminated comments', '<testsuite>' + '<!--'.repeat(250_000)],
    ['unterminated CDATA', '<testsuite>' + '<![CDATA['.repeat(120_000)],
    ['unterminated processing instructions', '<testsuite>' + '<?'.repeat(500_000)],
    ['unterminated quotes', '<testsuite><a ' + '"x '.repeat(350_000)],
  ])('refuses hostile %s of about 1 MiB in linear time', (_name, xml) => {
    const started = performance.now();
    expect(() => countJunit(xml)).toThrow(TestReportError);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('counts deeply nested well-formed input in linear time', () => {
    const depth = 60_000;
    const xml = `<testsuite>${'<x>'.repeat(depth)}${'<testcase/>'.repeat(depth)}${'</x>'.repeat(depth)}</testsuite>`;
    const started = performance.now();
    expect(countJunit(xml).passed).toBe(depth);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
