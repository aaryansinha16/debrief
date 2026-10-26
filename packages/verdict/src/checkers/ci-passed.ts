import type { Event } from '@debrief/schema';

import { num, str } from '../select.js';
import type { Checker, Finding } from '../types.js';
import { FAILED, isRun, namedWorkflow, noWitness, runLabel, selectCi, workflowOf } from './ci.js';

const conclusion = (run: Event): string => str(run.attrs, 'ci.conclusion') ?? 'unknown';

// A run that succeeded by skipping every job passed nothing.
const ranSomething = (run: Event): boolean => (num(run.attrs, 'ci.jobs.passed') ?? 1) > 0;

export const ciPassed: Checker = (claim, ctx): Finding => {
  const workflow = workflowOf(claim);
  const { events, missing } = selectCi(claim, ctx, (e) => isRun(e) && namedWorkflow(e, workflow));
  if (missing !== undefined) return missing;
  const failed = events.filter((run) => FAILED.has(conclusion(run)));
  if (failed.length > 0) {
    return {
      outcome: 'contradicted',
      evidence: failed,
      reason: failed.map((run) => `${runLabel(run)} concluded ${conclusion(run)}`).join('; '),
    };
  }
  const green = events.filter((run) => conclusion(run) === 'success' && ranSomething(run));
  if (green.length === events.length) {
    return {
      outcome: 'holds',
      evidence: green,
      reason: green.map((run) => `${runLabel(run)} concluded success`).join('; '),
    };
  }
  const other = events.filter((run) => !green.includes(run));
  return noWitness(
    other
      .map((run) =>
        ranSomething(run)
          ? `${runLabel(run)} concluded ${conclusion(run)}`
          : `${runLabel(run)} concluded success with every job skipped`,
      )
      .join('; '),
    other,
  );
};
