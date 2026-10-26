import { z } from 'zod';

const count = z.coerce.number().int().nonnegative();
const name = z.string().trim().min(1).max(200);

// ARCHITECTURE §18.3: the closed catalogue; a sentence that fits none of these is `unchecked`.
export const PREDICATES = {
  'tests.passed': {
    says: 'tests pass, with the counts the agent gave',
    params: { passed: count, failed: count, skipped: count, total: count },
  },
  'ci.passed': { says: 'CI or a named workflow run is green', params: { workflow: name } },
  'db.scope': {
    says: 'which database environment the agent changed, or only changed',
    params: { environment: z.enum(['production', 'staging', 'dev']) },
  },
  'migration.applied': { says: 'a schema migration is applied', params: { name } },
  'pr.opened': { says: 'a pull request was opened', params: { number: count } },
  'commit.pushed': { says: 'commits were pushed to a branch', params: { branch: name } },
  'deploy.ready': {
    says: 'a deployment is live or ready',
    params: { target: z.enum(['preview', 'production']) },
  },
  'files.changed': { says: 'which files, or how many, were edited', params: { count, path: name } },
  'code.removed': { says: 'code, a flag or a file was removed', params: { name } },
  'secret.rotated': { says: 'a secret or key was rotated', params: { name } },
} satisfies Record<string, { says: string; params: Record<string, z.ZodType> }>;

export type CheckedPredicate = keyof typeof PREDICATES;
export type Predicate = CheckedPredicate | 'unchecked';
export type ParamValue = string | number | boolean;

export const isCheckedPredicate = (value: string): value is CheckedPredicate =>
  Object.hasOwn(PREDICATES, value);

// Params the catalogue does not name, or whose value its schema refuses, are dropped; the claim stays.
export function predicateParams(
  predicate: Predicate,
  raw: readonly { name: string; value: string }[],
): Record<string, ParamValue> {
  if (predicate === 'unchecked') return {};
  const known: Record<string, z.ZodType> = PREDICATES[predicate].params;
  const params: Record<string, ParamValue> = {};
  for (const { name: key, value } of raw) {
    const schema = Object.hasOwn(known, key) ? known[key] : undefined;
    const parsed = schema?.safeParse(value);
    if (parsed?.success === true && !Object.hasOwn(params, key)) {
      params[key] = parsed.data as ParamValue;
    }
  }
  return params;
}
