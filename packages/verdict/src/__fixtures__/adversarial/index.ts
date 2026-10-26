import type { Event } from '@debrief/schema';

import type { Verdict, Window } from '../../types.js';
import { SHA_B, WINDOW, claim, gitState, ist, workflowRun } from '../events.js';

export interface AdversarialFixture {
  name: string;
  transcript: string;
  window: Window;
  events: Event[];
  expected: Record<string, Pick<Verdict, 'outcome'> & { trust?: Verdict['trust'] }>;
}

// D-085: every job green while the session skipped 3 tests; without a test report this stays no-witness.
export const jobsGreenTestsSkipped: AdversarialFixture = {
  name: 'all jobs green, 3 tests skipped in the session',
  transcript: 'All 142 tests pass. CI is green.',
  window: WINDOW,
  events: [
    claim({
      n: 1,
      at: ist('14:27:40'),
      text: 'All 142 tests pass.',
      predicate: 'tests.passed',
      subject: { system: 'github' },
      params: { passed: 142 },
    }),
    claim({
      n: 2,
      at: ist('14:27:41'),
      text: 'CI is green.',
      predicate: 'ci.passed',
      subject: { system: 'github' },
    }),
    gitState(10, ist('14:26:00'), SHA_B, [[3, 0, 'src/billing/invoice.spec.ts']]),
    workflowRun({ n: 11, at: ist('14:27:20'), sha: SHA_B, runId: 4182, jobs: { passed: 3 } }),
  ],
  expected: {
    'All 142 tests pass.': { outcome: 'no-witness' },
    'CI is green.': { outcome: 'holds', trust: 'third-party' },
  },
};

export const adversarial: AdversarialFixture[] = [jobsGreenTestsSkipped];
