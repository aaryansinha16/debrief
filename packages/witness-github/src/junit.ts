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

const NOISE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g;
const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

const malformed = (why: string): TestReportError => new TestReportError(`malformed JUnit: ${why}`);

// A <testcase> with an <error> or <failure> child failed, one with <skipped> was skipped, else it passed.
// Only <testsuites> and <testsuite> roots are read; any other shape is refused, never guessed at.
export function countJunit(xml: string): TestCounts {
  const text = xml.replace(NOISE, '');
  if (text.includes('<!')) throw malformed('unsupported markup');
  const counts: TestCounts = { passed: 0, failed: 0, skipped: 0 };
  const stack: string[] = [];
  let roots = 0;
  let failed = false;
  let skipped = false;
  let last = 0;
  const tally = (): void => {
    if (failed) counts.failed += 1;
    else if (skipped) counts.skipped += 1;
    else counts.passed += 1;
  };
  for (const match of text.matchAll(TAG)) {
    if (text.slice(last, match.index).includes('<')) throw malformed('stray <');
    last = match.index + match[0].length;
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
      if (parent === 'testcase') throw malformed('nested <testcase>');
      failed = false;
      skipped = false;
    } else if (parent === 'testcase') {
      if (name === 'failure' || name === 'error') failed = true;
      if (name === 'skipped') skipped = true;
    }
    if (!attributes.endsWith('/')) stack.push(name);
    else if (name === 'testcase') tally();
  }
  if (roots !== 1 || stack.length > 0 || text.slice(last).includes('<')) {
    throw malformed('no complete root element');
  }
  return counts;
}
