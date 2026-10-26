import { str } from '../select.js';
import type { Checker, Finding } from '../types.js';
import { FAILED, isRun, namedWorkflow, noWitness, runLabel, selectCi, workflowOf } from './ci.js';

export const ciPassed: Checker = (claim, ctx): Finding => {
  const workflow = workflowOf(claim);
  const { events, missing } = selectCi(ctx, (e) => isRun(e) && namedWorkflow(e, workflow));
  if (missing !== undefined) return missing;
  const conclusion = (run: (typeof events)[number]): string =>
    str(run.attrs, 'ci.conclusion') ?? 'unknown';
  const failed = events.filter((run) => FAILED.has(conclusion(run)));
  if (failed.length > 0) {
    return {
      outcome: 'contradicted',
      evidence: failed,
      reason: failed.map((run) => `${runLabel(run)} concluded ${conclusion(run)}`).join('; '),
    };
  }
  const green = events.filter((run) => conclusion(run) === 'success');
  if (green.length === events.length) {
    return {
      outcome: 'holds',
      evidence: green,
      reason: green.map((run) => `${runLabel(run)} concluded success`).join('; '),
    };
  }
  const other = events.filter((run) => conclusion(run) !== 'success');
  return noWitness(
    other.map((run) => `${runLabel(run)} concluded ${conclusion(run)}`).join('; '),
    other,
  );
};
