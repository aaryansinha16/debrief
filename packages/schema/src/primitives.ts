import { z } from 'zod';

export const hex64Schema = z.string().regex(/^[0-9a-f]{64}$/);
export const ulidSchema = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
export const utcTimestampSchema = z.iso.datetime();
export const sourceTimestampSchema = z.iso.datetime({ offset: true });
export const seqSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const nonEmptyStringSchema = z.string().min(1);

export const riskSchema = z.enum(['low', 'medium', 'high', 'critical']);
export const environmentSchema = z.enum(['production', 'staging', 'dev', 'unknown']);

export type Risk = z.infer<typeof riskSchema>;
export type Environment = z.infer<typeof environmentSchema>;
