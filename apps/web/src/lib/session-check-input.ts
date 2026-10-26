import {
  eventSchema,
  sourceTimestampSchema,
  ulidSchema,
  witnessTrustSchema,
} from '@debrief/schema';
import { z } from 'zod';

export const linkConfidenceSchema = z.enum(['exact', 'strong', 'weak']);

// ARCHITECTURE §18.5: the world event, the tool call it is linked to and how sure the link is (P-65 computes them).
export const sideEffectInputSchema = z.strictObject({
  worldEventId: ulidSchema,
  toolCallId: ulidSchema,
  confidence: linkConfidenceSchema,
  via: z.string().min(1).max(60).optional(),
});

export type SideEffectInput = z.infer<typeof sideEffectInputSchema>;

export const witnessInputSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('connected'),
    system: z.string().min(1),
    trust: witnessTrustSchema,
    observed: z.number().int().min(0),
  }),
  z.strictObject({ state: z.literal('missing'), system: z.string().min(1) }),
]);

export const sessionInputSchema = z.strictObject({
  id: z.string().min(1),
  agent: z.string().min(1),
  project: z.string().min(1).optional(),
  startedAt: sourceTimestampSchema,
  endedAt: sourceTimestampSchema.optional(),
  sample: z.boolean(),
});

// GET /v1/sessions/:id/check (P-65.1): claims, verdicts, every event they cite, side effects and the roster.
export const sessionCheckInputSchema = z.strictObject({
  session: sessionInputSchema,
  events: z.array(eventSchema),
  sideEffects: z.array(sideEffectInputSchema),
  witnesses: z.array(witnessInputSchema),
});

export type LinkConfidence = z.infer<typeof linkConfidenceSchema>;
export type SessionCheckInput = z.infer<typeof sessionCheckInputSchema>;
