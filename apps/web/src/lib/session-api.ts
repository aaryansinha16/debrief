import { eventSchema, sourceTimestampSchema, witnessTrustSchema } from '@debrief/schema';
import { z } from 'zod';

import { linkConfidenceSchema, linkReasonSchema } from './session-check-input';

// GET /v1/sessions (D-091): derived from events, newest message first.
export const sessionSummarySchema = z.object({
  id: z.string().min(1),
  startedAt: z.string().min(1),
  lastMessageAt: z.string().min(1),
  messages: z.number().int().min(0),
  claims: z.number().int().min(0),
  verdicts: z.number().int().min(0),
  checkedAt: z.string().min(1).optional(),
});

export const sessionListSchema = z.object({ sessions: z.array(sessionSummarySchema) });

const linkedChangeSchema = z.object({
  worldEventId: z.string().min(1),
  toolNodeId: z.string().min(1),
  toolEventIds: z.array(z.string().min(1)),
  confidence: linkConfidenceSchema,
  reason: linkReasonSchema,
  system: z.string(),
  summary: z.string(),
});

// GET /v1/sessions/:id/check (D-091): only what the page maps; the API may add fields.
export const sessionCheckApiSchema = z.object({
  session: z.object({
    id: z.string().min(1),
    window: z.object({ from: z.string().min(1), to: z.string().min(1) }),
    messages: z.number().int().min(0),
    agent: z.string().min(1).optional(),
    startedAt: sourceTimestampSchema,
    endedAt: sourceTimestampSchema,
  }),
  claims: z.array(
    z.object({
      id: z.string().min(1),
      predicate: z.string(),
      modality: z.enum(['asserted', 'hedged']),
      subject: z.object({ system: z.string() }).loose(),
    }),
  ),
  verdicts: z.array(
    z.object({
      claimId: z.string().min(1),
      outcome: z.enum(['holds', 'contradicted', 'no-witness']),
      evidence: z.array(z.string()),
      trust: witnessTrustSchema.optional(),
      checker: z.string(),
      reason: z.string(),
      eventId: z.string().optional(),
    }),
  ),
  sideEffects: z.object({
    effects: z.array(linkedChangeSchema),
    weak: z.array(linkedChangeSchema),
    covered: z.array(linkedChangeSchema.extend({ claimId: z.string() })),
  }),
  witnesses: z.array(
    z.object({ system: z.string(), trust: witnessTrustSchema, events: z.number().int().min(0) }),
  ),
  events: z.array(eventSchema),
  appended: z.number().int().min(0),
});

export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type SessionCheckApi = z.infer<typeof sessionCheckApiSchema>;
