import { randomBytes } from 'node:crypto';

export interface Traceparent {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export function parseTraceparent(value: unknown): Traceparent | undefined {
  if (typeof value !== 'string') return undefined;
  const match = TRACEPARENT.exec(value.trim().toLowerCase());
  if (match === null) return undefined;
  const [, traceId, spanId, flags] = match;
  if (traceId === undefined || spanId === undefined || flags === undefined) return undefined;
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return undefined;
  return { traceId, spanId, sampled: (Number.parseInt(flags, 16) & 1) === 1 };
}

export const formatTraceparent = (traceId: string, spanId: string, sampled = true): string =>
  `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;

export const randomTraceId = (): string => randomBytes(16).toString('hex');
export const randomSpanId = (): string => randomBytes(8).toString('hex');
