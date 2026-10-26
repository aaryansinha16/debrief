export interface TestCounts {
  passed: number;
  failed: number;
  skipped: number;
}

export class TestReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestReportError';
  }
}

// No alternative may match '<', so a failed match is linear and the scan never backtracks.
const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"<]*"|'[^'<]*'|[^<>"'])*)>/y;
const SKIPPED_MARKUP = [
  ['<!--', '-->'],
  ['<![CDATA[', ']]>'],
  ['<?', '?>'],
] as const;

const malformed = (why: string): TestReportError => new TestReportError(`malformed JUnit: ${why}`);

// A <testcase> with an <error> or <failure> child failed, one with <skipped> was skipped, else it passed.
// Only <testsuites> and <testsuite> roots are read; any other shape is refused, never guessed at.
export function countJunit(xml: string): TestCounts {
  const counts: TestCounts = { passed: 0, failed: 0, skipped: 0 };
  const stack: string[] = [];
  let roots = 0;
  let failed = false;
  let skipped = false;
  const tally = (): void => {
    if (failed) counts.failed += 1;
    else if (skipped) counts.skipped += 1;
    else counts.passed += 1;
  };
  for (let at = xml.indexOf('<'); at !== -1; at = xml.indexOf('<', at)) {
    const skip = SKIPPED_MARKUP.find(([open]) => xml.startsWith(open, at));
    if (skip) {
      const end = xml.indexOf(skip[1], at + skip[0].length);
      if (end === -1) throw malformed(`unterminated ${skip[0]}`);
      at = end + skip[1].length;
      continue;
    }
    TAG.lastIndex = at;
    const match = TAG.exec(xml);
    if (match === null) throw malformed('unsupported or unterminated markup');
    at += match[0].length;
    const [, closing, name = '', attributes = ''] = match;
    if (closing === '/') {
      if (stack.pop() !== name) throw malformed('unbalanced tags');
      if (name === 'testcase') tally();
      continue;
    }
    const parent = stack.at(-1);
    if (parent === undefined) {
      roots += 1;
      if (roots > 1 || (name !== 'testsuites' && name !== 'testsuite')) {
        throw malformed(`unexpected root <${name}>`);
      }
    }
    if (name === 'testcase') {
      if (stack.includes('testcase')) throw malformed('nested <testcase>');
      failed = false;
      skipped = false;
    } else if (parent === 'testcase') {
      if (name === 'failure' || name === 'error') failed = true;
      if (name === 'skipped') skipped = true;
    }
    if (!attributes.endsWith('/')) stack.push(name);
    else if (name === 'testcase') tally();
  }
  if (roots !== 1 || stack.length > 0) throw malformed('no complete root element');
  return counts;
}
