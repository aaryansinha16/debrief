import { z } from 'zod';

import { ulidSchema, witnessTrustSchema } from './primitives.js';

export const VERDICT_EVIDENCE_MAX = 100;

export const verdictOutcomeSchema = z.enum(['holds', 'contradicted', 'no-witness']);
export const verdictCheckerSchema = z
  .string()
  .regex(/^[a-z][a-z_]*(?:\.[a-z][a-z_]*)*@[1-9][0-9]*$/);

const ULID = '[0-7][0-9A-HJKMNP-TV-Z]{25}';
const evidenceSchema = z
  .string()
  .regex(new RegExp(`^${ULID}(?:,${ULID}){0,${String(VERDICT_EVIDENCE_MAX - 1)}}$`));

const VERDICT_KEYS: ReadonlySet<string> = new Set([
  'verdict.claim_id',
  'verdict.outcome',
  'verdict.evidence',
  'verdict.trust',
  'verdict.checker',
  'verdict.reason',
  'verdict.supersedes',
]);

// One encoding per evidence set, so equal verdicts hash equal (D-083).
export function encodeEvidence(ids: readonly string[]): string | undefined {
  const unique = [...new Set(ids)].sort();
  return unique.length === 0 ? undefined : unique.join(',');
}

export function decodeEvidence(value: string | undefined): string[] {
  return value === undefined ? [] : value.split(',');
}

export const verdictAttrsSchema = z
  .looseObject({
    'verdict.claim_id': ulidSchema,
    'verdict.outcome': verdictOutcomeSchema,
    'verdict.evidence': evidenceSchema.optional(),
    'verdict.trust': witnessTrustSchema.optional(),
    'verdict.checker': verdictCheckerSchema,
    'verdict.reason': z.string().min(1).max(280),
    'verdict.supersedes': ulidSchema.optional(),
  })
  .superRefine((attrs, ctx) => {
    const outcome = attrs['verdict.outcome'];
    const evidence = attrs['verdict.evidence'];
    const issue = (key: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [key], message });
    };
    if (outcome === 'no-witness') {
      if (attrs['verdict.trust'] !== undefined) {
        issue('verdict.trust', 'a no-witness verdict has no trust');
      }
    } else {
      if (evidence === undefined) issue('verdict.evidence', `a ${outcome} verdict cites evidence`);
      if (attrs['verdict.trust'] === undefined) {
        issue('verdict.trust', `a ${outcome} verdict records the trust behind it`);
      }
    }
    if (evidence !== undefined && encodeEvidence(decodeEvidence(evidence)) !== evidence) {
      issue('verdict.evidence', 'evidence ids are sorted and unique');
    }
    if (decodeEvidence(evidence).includes(attrs['verdict.claim_id'])) {
      issue('verdict.evidence', 'a verdict cannot cite its own claim');
    }
    for (const key of Object.keys(attrs)) {
      if (key.startsWith('verdict.') && !VERDICT_KEYS.has(key)) {
        issue(key, `unknown verdict attribute ${key}`);
      }
    }
  });

export type VerdictOutcome = z.infer<typeof verdictOutcomeSchema>;
export type VerdictAttrs = z.infer<typeof verdictAttrsSchema>;
