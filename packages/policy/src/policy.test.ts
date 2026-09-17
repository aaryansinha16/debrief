import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { evaluate, lookup, ruleMatches, scalarMatches, valueMatches } from './evaluate.js';
import { PolicyParseError, parsePolicy } from './parse.js';
import { ALLOW_ALL, type Policy } from './policy.js';

const prodGuard = readFileSync(new URL('./__fixtures__/prod-guard.yaml', import.meta.url), 'utf8');

const event = (target: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  kind: 'tool.call',
  actor: { type: 'agent', id: 'a' },
  target,
  attrs: {},
  ...extra,
});

describe('parsePolicy', () => {
  it('parses the ARCHITECTURE §10 sample', () => {
    const policy = parsePolicy(prodGuard);
    expect(policy.version).toBe(1);
    expect(policy.defaults).toBe('allow');
    expect(policy.rules.map((rule) => [rule.id, rule.effect])).toEqual([
      ['prod-destructive-needs-approval', 'require_approval'],
      ['token-scope-mismatch', 'deny'],
      ['unknown-environment-destructive', 'require_approval'],
    ]);
    expect(policy.rules[0]!.match['target.risk']).toEqual(['high', 'critical']);
  });

  it('applies defaults for an empty rule set', () => {
    expect(parsePolicy('version: 1\n')).toEqual(ALLOW_ALL);
    expect(parsePolicy('version: 1\ndefaults: deny\n').defaults).toBe('deny');
  });

  it.each([
    [
      'yaml syntax',
      'version: 1\nrules:\n  - id: x\n    match: { a: 1\n',
      5,
      /flow|expected|Missing/i,
    ],
    ['wrong version', 'version: 2\n', 1, /version/],
    [
      'unknown effect',
      'version: 1\nrules:\n  - id: x\n    match: { a: 1 }\n    effect: block\n',
      5,
      /effect/,
    ],
    [
      'bad rule id',
      'version: 1\nrules:\n  - id: Not Valid\n    match: { a: 1 }\n    effect: deny\n',
      3,
      /id/,
    ],
    ['empty match', 'version: 1\nrules:\n  - id: x\n    match: {}\n    effect: deny\n', 4, /match/],
    [
      'bad match key',
      'version: 1\nrules:\n  - id: x\n    match: { "a b": 1 }\n    effect: deny\n',
      4,
      /match/,
    ],
    [
      'unknown key',
      'version: 1\nrules:\n  - id: x\n    match: { a: 1 }\n    effect: deny\n    when: now\n',
      3,
      /unrecognized|when/i,
    ],
    [
      'duplicate ids',
      'version: 1\nrules:\n  - { id: x, match: { a: 1 }, effect: deny }\n  - { id: x, match: { a: 2 }, effect: deny }\n',
      3,
      /unique/,
    ],
    ['not a mapping', '- just\n- a list\n', 1, /policy|expected/i],
    ['empty document', '', 1, /policy|expected/i],
  ])('reports %s with a line number', (_label, text, line, message) => {
    let error: unknown;
    try {
      parsePolicy(text);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PolicyParseError);
    const parseError = error as PolicyParseError;
    expect(parseError.issues[0]!.line).toBe(line);
    expect(parseError.issues[0]!.column).toBeGreaterThanOrEqual(1);
    expect(parseError.issues[0]!.message).toMatch(message);
    expect(parseError.message).toMatch(/^\d+:\d+ /);
  });
});

describe('matching', () => {
  it('looks up dotted paths, preferring ctx over the subject', () => {
    const subject = { target: { environment: 'production' }, authority: { scope: ['a'] } };
    expect(lookup(subject, undefined, 'target.environment')).toBe('production');
    expect(lookup(subject, { target: { environment: 'staging' } }, 'target.environment')).toBe(
      'staging',
    );
    expect(lookup(subject, { authority: { scopeMismatch: true } }, 'authority.scopeMismatch')).toBe(
      true,
    );
    expect(lookup(subject, undefined, 'target.missing.deeper')).toBeUndefined();
    expect(lookup(subject, undefined, 'authority.scope.0')).toBe('a');
    const dotted = { attrs: { 'gen_ai.tool.name': 'echo', gen_ai: { tool: { name: 'nested' } } } };
    expect(lookup(dotted, undefined, 'attrs.gen_ai.tool.name')).toBe('echo');
    expect(
      lookup(
        { attrs: { gen_ai: { tool: { name: 'nested' } } } },
        undefined,
        'attrs.gen_ai.tool.name',
      ),
    ).toBe('nested');
    expect(
      lookup({ attrs: { 'gen_ai.tool': { name: 'mid' } } }, undefined, 'attrs.gen_ai.tool.name'),
    ).toBe('mid');
    expect(lookup({ attrs: 'scalar' }, undefined, 'attrs.gen_ai')).toBeUndefined();
  });

  it('matches scalars exactly or by verb prefix, case-insensitively', () => {
    expect(scalarMatches('delete', 'deleteVolume')).toBe(true);
    expect(scalarMatches('delete', 'delete_volume')).toBe(true);
    expect(scalarMatches('delete', 'DELETE')).toBe(true);
    expect(scalarMatches('delete', 'deleted')).toBe(false);
    expect(scalarMatches('prod', 'production')).toBe(false);
    expect(scalarMatches('delete', undefined)).toBe(false);
    expect(scalarMatches(true, true)).toBe(true);
    expect(scalarMatches(true, 'true')).toBe(false);
    expect(scalarMatches(3, 3)).toBe(true);
    expect(scalarMatches(3, 4)).toBe(false);
  });

  it('treats arrays as any-of on both sides', () => {
    expect(valueMatches(['high', 'critical'], 'critical')).toBe(true);
    expect(valueMatches(['high', 'critical'], 'low')).toBe(false);
    expect(valueMatches('account:*', ['staging:credentials', 'account:*'])).toBe(true);
    expect(valueMatches('x', undefined)).toBe(false);
  });

  it('requires every key of a rule to match', () => {
    const rule = parsePolicy(prodGuard).rules[0]!;
    expect(
      ruleMatches(
        rule,
        event({ environment: 'production', risk: 'critical', operation: 'deleteVolume' }),
      ),
    ).toBe(true);
    expect(
      ruleMatches(
        rule,
        event({ environment: 'staging', risk: 'critical', operation: 'deleteVolume' }),
      ),
    ).toBe(false);
    expect(
      ruleMatches(
        rule,
        event({ environment: 'production', risk: 'low', operation: 'deleteVolume' }),
      ),
    ).toBe(false);
    expect(
      ruleMatches(
        rule,
        event({ environment: 'production', risk: 'critical', operation: 'readFile' }),
      ),
    ).toBe(false);
  });
});

describe('evaluate', () => {
  const policy = parsePolicy(prodGuard);

  it('returns the first matching rule with an explanation, else the default', () => {
    const decision = evaluate(
      event({ environment: 'production', risk: 'critical', operation: 'deleteVolume' }),
      policy,
    );
    expect(decision).toEqual({
      effect: 'require_approval',
      ruleId: 'prod-destructive-needs-approval',
      explanation:
        'rule prod-destructive-needs-approval matched target.environment="production", target.risk="critical", target.operation="deleteVolume"',
    });
    expect(
      evaluate(event({ environment: 'production', risk: 'low', operation: 'readFile' }), policy),
    ).toEqual({
      effect: 'allow',
      explanation: 'no rule matched; default allow',
    });
    expect(
      evaluate(event({ environment: 'unknown', operation: 'drop_table' }), policy),
    ).toMatchObject({
      effect: 'require_approval',
      ruleId: 'unknown-environment-destructive',
    });
  });

  it('uses ctx for derived fields such as scopeMismatch', () => {
    const subject = event(
      { environment: 'staging', operation: 'rotateCredential' },
      { authority: { principalId: 'p' } },
    );
    expect(evaluate(subject, policy).effect).toBe('allow');
    expect(evaluate(subject, policy, { authority: { scopeMismatch: true } })).toMatchObject({
      effect: 'deny',
      ruleId: 'token-scope-mismatch',
    });
  });

  it('honours a deny default', () => {
    const denyAll: Policy = { version: 1, defaults: 'deny', rules: [] };
    expect(evaluate(event({}), denyAll)).toEqual({
      effect: 'deny',
      explanation: 'no rule matched; default deny',
    });
    expect(evaluate(event({}), ALLOW_ALL).effect).toBe('allow');
  });
});
