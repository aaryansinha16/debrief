import { z } from 'zod';

import { hex64Schema, nonEmptyStringSchema, utcTimestampSchema } from './primitives.js';

export const blobSchema = z.strictObject({
  sha256: hex64Schema,
  tenantId: nonEmptyStringSchema,
  size: z.number().int().min(0),
  mime: nonEmptyStringSchema,
  encrypted: z.boolean(),
  keyId: nonEmptyStringSchema.optional(),
  storageKey: nonEmptyStringSchema,
  createdAt: utcTimestampSchema,
});

export type Blob = z.infer<typeof blobSchema>;
