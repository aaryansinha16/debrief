import { z } from 'zod';

import { hex64Schema, nonEmptyStringSchema, seqSchema, utcTimestampSchema } from './primitives.js';

export const anchorSchema = z.strictObject({
  kind: z.enum(['rfc3161', 'rekor']),
  ref: nonEmptyStringSchema,
});

export const checkpointSchema = z.strictObject({
  tenantId: nonEmptyStringSchema,
  treeSize: seqSchema,
  rootHash: hex64Schema,
  headHash: hex64Schema,
  ts: utcTimestampSchema,
  keyId: nonEmptyStringSchema,
  signature: z.string().regex(/^[0-9a-f]{128}$/),
  anchor: anchorSchema.optional(),
});

export type Anchor = z.infer<typeof anchorSchema>;
export type Checkpoint = z.infer<typeof checkpointSchema>;
