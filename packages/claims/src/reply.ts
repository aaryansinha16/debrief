import { environmentSchema } from '@debrief/schema';
import { z } from 'zod';

// Requested as structured output: every field is required (nullable instead of optional) so the schema stays strict.
export const replySchema = z.object({
  claims: z.array(
    z.object({
      message_id: z.string(),
      quote: z.string(),
      modality: z.enum(['asserted', 'hedged']),
      predicate: z.string(),
      subject: z.object({
        system: z.string(),
        resource: z.string().nullable(),
        environment: environmentSchema.nullable(),
        operation: z.string().nullable(),
      }),
      params: z.array(z.object({ name: z.string(), value: z.string() })),
    }),
  ),
});

export type Reply = z.infer<typeof replySchema>;
export type ReplyClaim = Reply['claims'][number];
