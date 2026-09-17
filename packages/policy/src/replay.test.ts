import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { policyFixtureEvents } from './__fixtures__/events.js';
import { parsePolicy } from './parse.js';
import { ALLOW_ALL } from './policy.js';
import { counterfactual, decideWith, replay } from './replay.js';

const prodGuard = parsePolicy(
  readFileSync(new URL('./__fixtures__/prod-guard.yaml', import.meta.url), 'utf8'),
);
const unknownOnly = parsePolicy(`
version: 1
rules:
  - id: unknown-environment-destructive
    match: { target.environment: unknown, target.operation: [delete, drop, truncate] }
    effect: require_approval
`);
const events = policyFixtureEvents();

describe('replay', () => {
  it('splits the timeline at the freeze frame and marks everything after it', () => {
    const shuffled = [...events].reverse();
    const result = replay(shuffled, {
      eventId: events[9]!.id,
      effect: 'require_approval',
      explanation: 'x',
    });
    expect(result.halted).toBe(true);
    expect(result.prefix.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(JSON.stringify(result.prefix)).toBe(JSON.stringify(events.slice(0, 9)));
    expect(result.timeline.map((entry) => entry.status)).toEqual([
      ...Array<string>(9).fill('happened'),
      'freeze-frame',
      ...Array<string>(10).fill('would-not-have-happened'),
    ]);
    expect(result.marked).toEqual(events.slice(10).map((event) => event.id));
    expect(result.freezeFrame).toEqual({
      eventId: events[9]!.id,
      effect: 'require_approval',
      explanation: 'x',
    });
  });

  it('keeps the whole run when there is no freeze frame or it is not in the run', () => {
    for (const freeze of [
      undefined,
      { eventId: 'nope', effect: 'deny' as const, explanation: 'x' },
    ]) {
      const result = replay(events, freeze);
      expect(result).toEqual({
        halted: false,
        prefix: events,
        timeline: events.map((event) => ({ event, status: 'happened' })),
        marked: [],
      });
    }
  });
});

describe('counterfactual', () => {
  it('halts at the first non-allow decision in timeline order', () => {
    const result = counterfactual(events, decideWith(unknownOnly));
    expect(result.freezeFrame).toEqual({
      eventId: events[9]!.id,
      effect: 'require_approval',
      ruleId: 'unknown-environment-destructive',
      explanation:
        'rule unknown-environment-destructive matched target.environment="unknown", target.operation="deleteFile"',
    });
    expect(result.prefix).toHaveLength(9);
    expect(result.marked).toHaveLength(10);
    const strict = counterfactual(events, decideWith(prodGuard));
    expect(strict.freezeFrame?.eventId).toBe(events[0]!.id);
    expect(strict.prefix).toEqual([]);
    expect(strict.marked).toHaveLength(19);
  });

  it('halts nowhere under allow-all and honours a ctx override', () => {
    expect(counterfactual(events, decideWith(ALLOW_ALL)).halted).toBe(false);
    const denied = counterfactual(events, decideWith({ version: 1, defaults: 'deny', rules: [] }));
    expect(denied.freezeFrame).toEqual({
      eventId: events[0]!.id,
      effect: 'deny',
      explanation: 'no rule matched; default deny',
    });
    const overridden = counterfactual(
      events.slice(17, 19),
      decideWith(prodGuard, { authority: { scopeMismatch: true } }),
    );
    expect(overridden.freezeFrame?.ruleId).toBe('token-scope-mismatch');
  });
});
