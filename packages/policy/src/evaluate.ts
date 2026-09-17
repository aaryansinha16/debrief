import type { Effect, MatchScalar, MatchValue, Policy, Rule } from './policy.js';

export interface Decision {
  effect: Effect;
  ruleId?: string;
  explanation: string;
}

export type Subject = Record<string, unknown>;

// Keys may themselves contain dots (attrs['gen_ai.tool.name']); the longest key that exists wins at each level.
function resolve(node: unknown, segments: readonly string[]): unknown {
  if (segments.length === 0) return node;
  if (node === null || typeof node !== 'object') return undefined;
  const record = node as Record<string, unknown>;
  for (let take = segments.length; take >= 1; take -= 1) {
    const key = segments.slice(0, take).join('.');
    if (key in record) {
      const found = resolve(record[key], segments.slice(take));
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

export function lookup(subject: Subject, ctx: Subject | undefined, path: string): unknown {
  const segments = path.split('.');
  const fromCtx = ctx === undefined ? undefined : resolve(ctx, segments);
  return fromCtx ?? resolve(subject, segments);
}

// Strings match case-insensitively, exactly or as a verb prefix ("delete" matches "deleteVolume", not "deleted").
export function scalarMatches(expected: MatchScalar, actual: unknown): boolean {
  if (typeof expected !== 'string' || typeof actual !== 'string') return expected === actual;
  const want = expected.toLowerCase();
  const have = actual.toLowerCase();
  if (want === have) return true;
  if (!have.startsWith(want)) return false;
  const boundary = actual.charAt(expected.length);
  return boundary !== boundary.toLowerCase() || /[^a-z0-9]/i.test(boundary);
}

export function valueMatches(expected: MatchValue, actual: unknown): boolean {
  const candidates = Array.isArray(expected) ? expected : [expected];
  const actuals = Array.isArray(actual) ? actual : [actual];
  return candidates.some((candidate) => actuals.some((value) => scalarMatches(candidate, value)));
}

export function ruleMatches(rule: Rule, subject: Subject, ctx?: Subject): boolean {
  return Object.entries(rule.match).every(([path, expected]) =>
    valueMatches(expected, lookup(subject, ctx, path)),
  );
}

const describe = (rule: Rule, subject: Subject, ctx?: Subject): string =>
  Object.keys(rule.match)
    .map((path) => `${path}=${JSON.stringify(lookup(subject, ctx, path))}`)
    .join(', ');

// ARCHITECTURE §10: first matching rule wins; otherwise the policy default applies.
export function evaluate(subject: Subject, policy: Policy, ctx?: Subject): Decision {
  for (const rule of policy.rules) {
    if (ruleMatches(rule, subject, ctx)) {
      return {
        effect: rule.effect,
        ruleId: rule.id,
        explanation: `rule ${rule.id} matched ${describe(rule, subject, ctx)}`,
      };
    }
  }
  return { effect: policy.defaults, explanation: `no rule matched; default ${policy.defaults}` };
}
