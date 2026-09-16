import { z } from 'zod';

import { nonEmptyStringSchema, riskSchema, utcTimestampSchema } from './primitives.js';

export const runStatusSchema = z.enum(['active', 'ended']);

export const runSchema = z.strictObject({
  id: nonEmptyStringSchema,
  tenantId: nonEmptyStringSchema,
  principalId: nonEmptyStringSchema,
  agentName: z.string(),
  startedAt: utcTimestampSchema,
  endedAt: utcTimestampSchema.optional(),
  eventCount: z.number().int().min(0),
  status: runStatusSchema,
  riskMax: riskSchema.optional(),
  divergenceCount: z.number().int().min(0),
  layout: z.record(z.string(), z.unknown()).optional(),
  graphVersion: z.number().int().min(0),
});

export type RunStatus = z.infer<typeof runStatusSchema>;
export type Run = z.infer<typeof runSchema>;
