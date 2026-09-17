import { type Policy, PolicyParseError, type PolicyIssue, parsePolicy } from '@debrief/policy';
import type { ScrubberMarker } from '@debrief/ui';

import type { Counterfactual } from './api';

export type Validation = { ok: true; policy: Policy } | { ok: false; issues: PolicyIssue[] };

// Anything the parser throws becomes a line-anchored issue; a non-parser failure lands on line 1 with its message.
export const issuesOf = (error: unknown): PolicyIssue[] =>
  error instanceof PolicyParseError
    ? [...error.issues]
    : [{ line: 1, column: 1, message: error instanceof Error ? error.message : String(error) }];

// The editor validates in the browser with the same parser the API uses; the API is only asked for a branch of a valid policy.
export function validatePolicy(yaml: string): Validation {
  try {
    return { ok: true, policy: parsePolicy(yaml) };
  } catch (error) {
    return { ok: false, issues: issuesOf(error) };
  }
}

export const issueLines = (issues: readonly PolicyIssue[]): ReadonlySet<number> =>
  new Set(issues.map((issue) => issue.line));

export const haltTime = (
  branch: Counterfactual,
  timeOf: (eventId: string) => number | undefined,
): number | undefined =>
  branch.freezeFrame === undefined ? undefined : timeOf(branch.freezeFrame.eventId);

export function branchMarkers(
  branch: Counterfactual,
  timeOf: (eventId: string) => number | undefined,
): ScrubberMarker[] {
  const at = haltTime(branch, timeOf);
  const freeze = branch.freezeFrame;
  if (at === undefined || freeze === undefined) return [];
  return [{ t: at, label: `${freeze.effect} · ${freeze.ruleId ?? 'default'}`, kind: 'freeze' }];
}

export function branchSummary(branch: Counterfactual): string {
  const freeze = branch.freezeFrame;
  if (!branch.halted || freeze === undefined) return 'no halt: the run plays through unchanged';
  const seq = branch.timeline.find((entry) => entry.event.id === freeze.eventId)?.event.seq;
  const rule = freeze.ruleId ?? 'default';
  const marked = branch.marked.length;
  return `halts at #${String(seq ?? '?')}: ${rule} → ${freeze.effect} · ${String(marked)} event${marked === 1 ? '' : 's'} would not have happened`;
}
