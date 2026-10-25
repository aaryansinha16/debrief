import { z } from 'zod';

export const CLAIM_TEXT_MAX = 1000;

export const claimModalitySchema = z.enum(['asserted', 'hedged']);
export const claimPredicateSchema = z
  .string()
  .regex(/^(?:unchecked|[a-z][a-z_]*(?:\.[a-z][a-z_]*)+)$/);

const CLAIM_KEYS: ReadonlySet<string> = new Set([
  'claim.text',
  'claim.span.message_id',
  'claim.span.start',
  'claim.span.end',
  'claim.modality',
  'claim.predicate',
]);
const CLAIM_PARAM = /^claim\.param\.[a-z][a-z0-9_]*$/;
const offsetSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

// D-083: span offsets are UTF-16 units into the redacted message, so `end − start` is the text's length.
export const claimAttrsSchema = z
  .looseObject({
    'claim.text': z.string().min(1).max(CLAIM_TEXT_MAX),
    'claim.span.message_id': z.string().min(1).max(256),
    'claim.span.start': offsetSchema,
    'claim.span.end': offsetSchema,
    'claim.modality': claimModalitySchema,
    'claim.predicate': claimPredicateSchema,
  })
  .superRefine((attrs, ctx) => {
    if (attrs['claim.span.end'] - attrs['claim.span.start'] !== attrs['claim.text'].length) {
      ctx.addIssue({
        code: 'custom',
        path: ['claim.span.end'],
        message: 'the span must cover exactly the claim text',
      });
    }
    for (const key of Object.keys(attrs)) {
      if (key.startsWith('claim.') && !CLAIM_KEYS.has(key) && !CLAIM_PARAM.test(key)) {
        ctx.addIssue({ code: 'custom', path: [key], message: `unknown claim attribute ${key}` });
      }
    }
  });

export type ClaimModality = z.infer<typeof claimModalitySchema>;
export type ClaimAttrs = z.infer<typeof claimAttrsSchema>;
