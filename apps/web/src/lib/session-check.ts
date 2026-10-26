import {
  attrValueSchema,
  claimModalitySchema,
  eventKindSchema,
  sourceTimestampSchema,
  targetSchema,
  ulidSchema,
  verdictOutcomeSchema,
  witnessTrustSchema,
} from '@debrief/schema';
import { z } from 'zod';

import { sessionInputSchema } from './session-check-input';

export const evidenceViewSchema = z.strictObject({
  id: ulidSchema,
  kind: eventKindSchema,
  target: targetSchema.optional(),
  summary: z.string().optional(),
  at: sourceTimestampSchema,
  trust: witnessTrustSchema,
});

export const verdictViewSchema = z.strictObject({
  id: ulidSchema,
  outcome: verdictOutcomeSchema,
  trust: witnessTrustSchema.optional(),
  checker: z.string(),
  reason: z.string(),
  at: sourceTimestampSchema,
  evidence: z.array(evidenceViewSchema),
  supersedes: ulidSchema.optional(),
});

export const claimStateSchema = z.enum([
  'contradicted',
  'holds',
  'no-witness',
  'pending',
  'hedged',
]);

export const claimViewSchema = z.strictObject({
  id: ulidSchema,
  text: z.string(),
  saidAt: sourceTimestampSchema,
  modality: claimModalitySchema,
  predicate: z.string(),
  subject: targetSchema,
  params: z.record(z.string(), attrValueSchema),
  state: claimStateSchema,
  witness: z.enum(['connected', 'missing']),
  verdict: verdictViewSchema.optional(),
  history: z.array(verdictViewSchema),
});

const count = z.number().int().min(0);

// `claims` counts the scored ones: asserted, with a verdict. Hedged claims are shown and never scored (§18.3).
export const checkCountsSchema = z.strictObject({
  claims: count,
  holds: count,
  contradicted: count,
  noWitness: count,
  local: count,
  pending: count,
  hedged: count,
});

export const sessionCheckSchema = z.strictObject({
  session: sessionInputSchema,
  counts: checkCountsSchema,
  claims: z.array(claimViewSchema),
});

export type EvidenceView = z.infer<typeof evidenceViewSchema>;
export type VerdictView = z.infer<typeof verdictViewSchema>;
export type ClaimState = z.infer<typeof claimStateSchema>;
export type ClaimView = z.infer<typeof claimViewSchema>;
export type CheckCounts = z.infer<typeof checkCountsSchema>;
export type SessionCheck = z.infer<typeof sessionCheckSchema>;
