import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import golden from '../__golden__/prod-guard-decisions.json';
import { policyFixtureEvents } from './__fixtures__/events.js';
import { parsePolicy } from './parse.js';
import { ALLOW_ALL } from './policy.js';
import { evaluateEvent, subjectOf } from './subject.js';

const prodGuard = parsePolicy(
  readFileSync(new URL('./__fixtures__/prod-guard.yaml', import.meta.url), 'utf8'),
);
const events = policyFixtureEvents();

const EXPECTED: readonly [number, string, string | undefined][] = [
  [0, 'require_approval', 'prod-destructive-needs-approval'],
  [1, 'require_approval', 'prod-destructive-needs-approval'],
  [2, 'require_approval', 'prod-destructive-needs-approval'],
  [3, 'require_approval', 'prod-destructive-needs-approval'],
  [4, 'allow', undefined],
  [5, 'allow', undefined],
  [6, 'allow', undefined],
  [7, 'allow', undefined],
  [8, 'require_approval', 'prod-destructive-needs-approval'],
  [9, 'require_approval', 'unknown-environment-destructive'],
  [10, 'allow', undefined],
  [11, 'require_approval', 'unknown-environment-destructive'],
  [12, 'allow', undefined],
  [13, 'require_approval', 'prod-destructive-needs-approval'],
  [14, 'deny', 'token-scope-mismatch'],
  [15, 'allow', undefined],
  [16, 'deny', 'token-scope-mismatch'],
  [17, 'allow', undefined],
  [18, 'allow', undefined],
  [19, 'require_approval', 'prod-destructive-needs-approval'],
];

describe('the ARCHITECTURE §10 rules over the fixture run', () => {
  it('has twenty events and decides each one as intended', () => {
    expect(events).toHaveLength(20);
    const decided = events.map((event) => {
      const decision = evaluateEvent(event, prodGuard);
      return [event.seq, decision.effect, decision.ruleId] as const;
    });
    expect(decided).toEqual(EXPECTED);
  });

  it('matches the golden decisions', () => {
    const rows = events.map((event) => ({
      seq: event.seq,
      id: event.id,
      kind: event.kind,
      summary: event.summary,
      ...evaluateEvent(event, prodGuard),
    }));
    expect(rows).toEqual(golden);
    expect(rows.filter((row) => row.effect !== 'allow').map((row) => row.seq)).toEqual([
      0, 1, 2, 3, 8, 9, 11, 13, 14, 16, 19,
    ]);
  });

  it('explains every non-allow decision with the matched values', () => {
    expect(evaluateEvent(events[13]!, prodGuard).explanation).toBe(
      'rule prod-destructive-needs-approval matched target.environment="production", target.risk="critical", target.operation="deleteVolume"',
    );
    expect(evaluateEvent(events[14]!, prodGuard).explanation).toBe(
      'rule token-scope-mismatch matched authority.scopeMismatch=true',
    );
    expect(evaluateEvent(events[18]!, ALLOW_ALL)).toEqual({
      effect: 'allow',
      explanation: 'no rule matched; default allow',
    });
  });
});

describe('subjectOf', () => {
  it('derives scopeMismatch only for major mismatches and leaves other fields intact', () => {
    const minor = subjectOf(events[12]!);
    expect(minor.authority).toMatchObject({
      tokenRef: 'tok-stg-7f3a',
      scopeMismatch: false,
      scopeExcess: ['staging:files:read'],
    });
    const major = subjectOf(events[13]!);
    expect(major.authority).toMatchObject({ scopeMismatch: true, scopeExcess: ['account:*'] });
    const clean = subjectOf(events[19]!);
    expect(clean.authority).toMatchObject({ scopeMismatch: false, scopeExcess: [] });
    expect(subjectOf(events[18]!)).toEqual(events[18]);
    expect(subjectOf(events[0]!)).not.toHaveProperty('authority');
  });

  it('lets ctx override the derived fields', () => {
    expect(evaluateEvent(events[17]!, prodGuard).effect).toBe('allow');
    expect(
      evaluateEvent(events[17]!, prodGuard, { authority: { scopeMismatch: true } }),
    ).toMatchObject({ effect: 'deny', ruleId: 'token-scope-mismatch' });
    expect(
      evaluateEvent(events[16]!, prodGuard, { authority: { scopeMismatch: false } }).effect,
    ).toBe('allow');
  });
});
