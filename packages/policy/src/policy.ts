import { z } from 'zod';

export const effectSchema = z.enum(['allow', 'deny', 'require_approval']);
export type Effect = z.infer<typeof effectSchema>;

const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);
export const matchValueSchema = z.union([scalarSchema, z.array(scalarSchema).min(1)]);
export type MatchScalar = z.infer<typeof scalarSchema>;
export type MatchValue = z.infer<typeof matchValueSchema>;

export const ruleSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, 'rule ids are lowercase, digits, - and _'),
  description: z.string().optional(),
  match: z
    .record(z.string().regex(/^[a-zA-Z0-9_.]+$/, 'match keys are dotted paths'), matchValueSchema)
    .refine((m) => Object.keys(m).length > 0, 'match needs at least one key'),
  effect: effectSchema,
});
export type Rule = z.infer<typeof ruleSchema>;

export const policySchema = z
  .strictObject({
    version: z.literal(1),
    defaults: effectSchema.default('allow'),
    rules: z.array(ruleSchema).default([]),
  })
  .refine((policy) => new Set(policy.rules.map((rule) => rule.id)).size === policy.rules.length, {
    message: 'rule ids must be unique',
    path: ['rules'],
  });
export type Policy = z.infer<typeof policySchema>;

export const ALLOW_ALL: Policy = { version: 1, defaults: 'allow', rules: [] };
