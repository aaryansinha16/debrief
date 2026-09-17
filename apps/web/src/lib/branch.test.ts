import { PROD_GUARD_YAML } from '@debrief/policy';
import { createReplay } from '@debrief/ui';
import { describe, expect, it } from 'vitest';

import counterfactualGolden from '../../../../packages/reconstruct/__golden__/nine-seconds.counterfactual.json' with { type: 'json' };
import type { Counterfactual } from './api';
import {
  branchMarkers,
  branchSummary,
  haltTime,
  issueLines,
  issuesOf,
  validatePolicy,
} from './branch';

const branch = counterfactualGolden as unknown as Counterfactual;

describe('validatePolicy', () => {
  it('parses the sample and reports line-anchored issues for a broken one', () => {
    const ok = validatePolicy(PROD_GUARD_YAML);
    expect(ok.ok).toBe(true);
    const broken = validatePolicy(PROD_GUARD_YAML.replace('effect: deny', 'effect: nope'));
    expect(broken.ok).toBe(false);
    if (!broken.ok) {
      expect(broken.issues.length).toBeGreaterThan(0);
      expect(broken.issues[0]?.line).toBeGreaterThan(0);
      expect(issueLines(broken.issues).has(broken.issues[0]!.line)).toBe(true);
    }
    const garbage = validatePolicy('version: [');
    expect(garbage.ok).toBe(false);
    expect(issueLines([]).size).toBe(0);
    expect(issuesOf(new Error('boom'))).toEqual([{ line: 1, column: 1, message: 'boom' }]);
    expect(issuesOf('odd')).toEqual([{ line: 1, column: 1, message: 'odd' }]);
  });
});

describe('branch helpers', () => {
  const replay = createReplay(branch.timeline.map((entry) => entry.event));
  const timeOf = (id: string): number | undefined => replay.timeOf(id);

  it('marks the halt on the timeline and sums it up', () => {
    const at = haltTime(branch, timeOf);
    expect(at).toBe(replay.timeOf(branch.freezeFrame!.eventId));
    expect(branchMarkers(branch, timeOf)).toEqual([
      { t: at, label: 'require_approval · prod-destructive-needs-approval', kind: 'freeze' },
    ]);
    expect(branchSummary(branch)).toBe(
      'halts at #45: prod-destructive-needs-approval → require_approval · 4 events would not have happened',
    );
  });

  it('reads an unhalted branch and an unknown freeze event', () => {
    const open: Counterfactual = { ...branch, halted: false, freezeFrame: undefined, marked: [] };
    expect(haltTime(open, timeOf)).toBeUndefined();
    expect(branchMarkers(open, timeOf)).toEqual([]);
    expect(branchSummary(open)).toBe('no halt: the run plays through unchanged');
    const elsewhere: Counterfactual = {
      ...branch,
      freezeFrame: { eventId: 'nowhere', effect: 'deny', explanation: 'x' },
      marked: ['one'],
    };
    expect(branchMarkers(elsewhere, timeOf)).toEqual([]);
    const byDefault: Counterfactual = {
      ...branch,
      freezeFrame: { eventId: branch.freezeFrame!.eventId, effect: 'deny', explanation: 'x' },
    };
    expect(branchMarkers(byDefault, timeOf)[0]?.label).toBe('deny · default');
    expect(branchSummary(elsewhere)).toBe(
      'halts at #?: default → deny · 1 event would not have happened',
    );
  });
});
