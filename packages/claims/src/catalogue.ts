type ParamKind = 'count' | 'name' | readonly string[];

const ENVIRONMENTS = ['production', 'staging', 'dev'] as const;

// ARCHITECTURE §18.3: the closed catalogue; a sentence that fits none of these is `unchecked`.
export const PREDICATES = {
  'tests.passed': {
    says: 'tests pass, with the counts the agent gave',
    params: { passed: 'count', failed: 'count', skipped: 'count', total: 'count' },
  },
  'ci.passed': { says: 'CI or a named workflow run is green', params: { workflow: 'name' } },
  'db.scope': {
    says: 'which database environment the agent changed, or only changed',
    params: { environment: ENVIRONMENTS },
  },
  'migration.applied': { says: 'a schema migration is applied', params: { name: 'name' } },
  'pr.opened': { says: 'a pull request was opened', params: { number: 'count' } },
  'commit.pushed': { says: 'commits were pushed to a branch', params: { branch: 'name' } },
  'deploy.ready': {
    says: 'a deployment is live or ready',
    params: { target: ['preview', 'production'] },
  },
  'files.changed': {
    says: 'which files, or how many, were edited',
    params: { count: 'count', path: 'name' },
  },
  'code.removed': { says: 'code, a flag or a file was removed', params: { name: 'name' } },
  'secret.rotated': { says: 'a secret or key was rotated', params: { name: 'name' } },
} satisfies Record<string, { says: string; params: Record<string, ParamKind> }>;

export type CheckedPredicate = keyof typeof PREDICATES;
export type Predicate = CheckedPredicate | 'unchecked';
export type ParamValue = string | number;

export const isCheckedPredicate = (value: string): value is CheckedPredicate =>
  Object.hasOwn(PREDICATES, value);

const WORDS: Readonly<Record<string, RegExp>> = {
  production: /\bprod(?:uction)?\b/i,
  staging: /\bstag(?:e|ing)\b/i,
  dev: /\bdev(?:elopment)?\b/i,
  preview: /\bpreview\b/i,
};

// An environment counts only when the text names it, under its own name or a usual short form.
export const namesEnvironment = (text: string, value: string): boolean =>
  WORDS[value]?.test(text) ?? false;

export interface Said {
  quote: string;
  message: string;
}

// A param stands only on what the agent said: a count among the quote's numbers, a name or an environment in its message.
function readParam(kind: ParamKind, value: string, said: Said): ParamValue | undefined {
  const text = value.trim();
  if (kind === 'count') {
    const numbers = (said.quote.match(/\d[\d,_]*/g) ?? []).map((n) => n.replace(/[,_]/g, ''));
    const plain = /^\d{1,9}$/.test(text) ? String(Number(text)) : undefined;
    return plain !== undefined && numbers.some((n) => String(Number(n)) === plain)
      ? Number(plain)
      : undefined;
  }
  if (kind === 'name') {
    const fits = text !== '' && text.length <= 200;
    return fits && said.message.toLowerCase().includes(text.toLowerCase()) ? text : undefined;
  }
  return kind.includes(text) && namesEnvironment(said.message, text) ? text : undefined;
}

export function predicateParams(
  predicate: Predicate,
  raw: readonly { name: string; value: string }[],
  said: Said,
): Record<string, ParamValue> {
  if (predicate === 'unchecked') return {};
  const kinds: Readonly<Record<string, ParamKind>> = PREDICATES[predicate].params;
  const params: Record<string, ParamValue> = {};
  for (const { name, value } of raw) {
    const kind = Object.hasOwn(kinds, name) ? kinds[name] : undefined;
    const read = kind === undefined ? undefined : readParam(kind, value, said);
    if (read !== undefined && !Object.hasOwn(params, name)) params[name] = read;
  }
  return params;
}
