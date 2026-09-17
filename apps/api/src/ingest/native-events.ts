import { eventInputSchema, isContentAttribute } from '@debrief/schema';
import { z } from 'zod';

export const MAX_BATCH_EVENTS = 1000;
export const MAX_BATCH_BYTES = 1024 * 1024;

export const nativeEventSchema = eventInputSchema
  .omit({ id: true, ts: true, tenantId: true })
  .extend({
    source: z.enum(['mcp-proxy', 'world-hook', 'api']),
    sourceId: z.string().min(1).max(512).optional(),
  })
  .refine((event) => Object.keys(event.attrs).every((name) => !isContentAttribute(name)), {
    message: 'content attributes are not accepted on /v1/events; use the blob API',
    path: ['attrs'],
  });

export const nativeBatchSchema = z
  .strictObject({ events: z.array(nativeEventSchema).min(1).max(MAX_BATCH_EVENTS) })
  .refine((batch) => !JSON.stringify(batch).includes('\\u0000'), {
    message: 'NUL characters are not allowed',
  });

export type NativeEvent = z.infer<typeof nativeEventSchema>;
export type NativeBatch = z.infer<typeof nativeBatchSchema>;
