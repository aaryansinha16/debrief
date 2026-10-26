// Three JUnit files as a CI uploads them: nested suites, a skipped case, an errored case.
export const JUNIT_FILES: Record<string, string> = {
  'api.xml': `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="9" failures="1" errors="0" time="1.2">
    <testsuite name="src/orders.test.ts" tests="5" failures="0" errors="0" skipped="1">
        <testcase classname="src/orders.test.ts" name="creates an order" time="0.01"></testcase>
        <testcase classname="src/orders.test.ts" name="lists orders" time="0.01"></testcase>
        <testcase classname="src/orders.test.ts" name="pages orders" time="0.01"></testcase>
        <testcase classname="src/orders.test.ts" name="cancels an order" time="0.01"></testcase>
        <testcase classname="src/orders.test.ts" name="refunds in bulk" time="0">
            <skipped/>
        </testcase>
    </testsuite>
    <testsuite name="src/auth" tests="4">
        <testsuite name="src/auth/session.test.ts" tests="4" errors="1">
            <testcase classname="src/auth/session.test.ts" name="issues a session" time="0.02"></testcase>
            <testcase classname="src/auth/session.test.ts" name="expires a session" time="0.02"></testcase>
            <testcase classname="src/auth/session.test.ts" name="rotates keys" time="0.02"></testcase>
            <testcase classname="src/auth/session.test.ts" name="reads the clock" time="0.03">
                <error message="Cannot read properties of undefined (reading 'now')" type="TypeError">TypeError: Cannot read properties of undefined</error>
            </testcase>
        </testsuite>
    </testsuite>
</testsuites>
`,
  'web.xml': `<?xml version="1.0" encoding="UTF-8" ?>
<testsuite name="web" tests="5" failures="1">
    <testcase classname="button" name="renders" time="0.01"/>
    <testcase classname="button" name="clicks" time="0.01"/>
    <testcase classname="form" name="validates" time="0.01"/>
    <testcase classname="form" name="submits" time="0.01"/>
    <testcase classname="form" name="rejects bad input" time="0.01">
        <failure message="expected 'a &gt; b'" type="AssertionError"><![CDATA[<div>not found</div>]]></failure>
    </testcase>
</testsuite>
`,
  'core.xml': `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites>
    <testsuite name="core" tests="5">
        <testcase classname="core" name="hashes" time="0.01"/>
        <testcase classname="core" name="signs" time="0.01"/>
        <testcase classname="core" name="verifies" time="0.01"/>
        <testcase classname="core" name="proves" time="0.01"/>
        <testcase classname="core" name="exports" time="0"><skipped message="needs network"/></testcase>
    </testsuite>
</testsuites>
`,
};

export const JUNIT_COUNTS = { passed: 15, failed: 2, skipped: 2 };

// What a test-reporter check run records for the same files: its title carries the counts.
export const REPORTER_OUTPUT = {
  title: '2 fail, 2 skipped, 15 pass in 14s',
  summary: '19 tests   15 passed   2 skipped   2 failed',
};
