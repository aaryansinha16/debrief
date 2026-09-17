import { type OtelAttrValue, type OtelSpan, otelSpanSchema } from '@debrief/schema';
import type protobufjs from 'protobufjs';
import { z } from 'zod';

import { ExportTraceServiceRequest } from './otlp-proto.js';

export class OtlpDecodeError extends Error {
  override readonly name = 'OtlpDecodeError';
}

const anyValueSchema: z.ZodType = z.lazy(() =>
  z
    .object({
      stringValue: z.string().optional(),
      boolValue: z.boolean().optional(),
      intValue: z.union([z.string(), z.number()]).optional(),
      doubleValue: z.number().optional(),
      bytesValue: z.string().optional(),
      arrayValue: z.object({ values: z.array(anyValueSchema).optional() }).optional(),
      kvlistValue: z.object({ values: z.array(keyValueSchema).optional() }).optional(),
    })
    .partial(),
);

const keyValueSchema = z.object({ key: z.string(), value: anyValueSchema.optional() });

const idSchema = z.union([z.string(), z.instanceof(Uint8Array)]);

const spanSchema = z.object({
  traceId: idSchema,
  spanId: idSchema,
  parentSpanId: idSchema.optional(),
  name: z.string().default(''),
  kind: z.union([z.number().int(), z.string()]).optional(),
  startTimeUnixNano: z.union([z.string(), z.number()]).default('0'),
  endTimeUnixNano: z.union([z.string(), z.number()]).default('0'),
  attributes: z.array(keyValueSchema).default([]),
  status: z
    .object({
      code: z.union([z.number().int(), z.string()]).optional(),
      message: z.string().optional(),
    })
    .default({}),
});

const requestSchema = z.object({
  resourceSpans: z
    .array(
      z.object({
        resource: z.object({ attributes: z.array(keyValueSchema).default([]) }).optional(),
        scopeSpans: z.array(z.object({ spans: z.array(spanSchema).default([]) })).default([]),
      }),
    )
    .default([]),
});

interface AnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string | number;
  doubleValue?: number;
  bytesValue?: string;
  arrayValue?: { values?: AnyValue[] };
  kvlistValue?: { values?: { key: string; value?: AnyValue }[] };
}

const SPAN_KINDS = ['unspecified', 'internal', 'server', 'client', 'producer', 'consumer'] as const;
const STATUS_CODES = ['unset', 'ok', 'error'] as const;

function decodeInt(value: string | number): string | number {
  const asNumber = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(asNumber) ? asNumber : String(value);
}

function primitive(value: AnyValue): string | number | boolean | undefined {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.intValue !== undefined) return decodeInt(value.intValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.bytesValue !== undefined) return value.bytesValue;
  return undefined;
}

function toAttrValue(value: AnyValue | undefined): OtelAttrValue | undefined {
  if (value === undefined) return undefined;
  const scalar = primitive(value);
  if (scalar !== undefined) return scalar;
  if (value.arrayValue !== undefined) {
    const items = (value.arrayValue.values ?? []).map(
      (item) => primitive(item) ?? JSON.stringify(toAttrValue(item)),
    );
    return items;
  }
  if (value.kvlistValue !== undefined) {
    const entries = (value.kvlistValue.values ?? []).map(
      (kv) => [kv.key, toAttrValue(kv.value)] as const,
    );
    return JSON.stringify(Object.fromEntries(entries));
  }
  return undefined;
}

function toAttributes(
  list: readonly { key: string; value?: unknown }[],
): Record<string, OtelAttrValue> {
  const out: Record<string, OtelAttrValue> = {};
  for (const { key, value } of list) {
    const converted = toAttrValue(value as AnyValue | undefined);
    if (converted !== undefined) out[key] = converted;
  }
  return out;
}

function toHexId(value: string | Uint8Array, bytes: number): string {
  if (typeof value !== 'string') return Buffer.from(value).toString('hex');
  if (new RegExp(`^[0-9a-fA-F]{${String(bytes * 2)}}$`).test(value)) return value.toLowerCase();
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === bytes) return decoded.toString('hex');
  throw new OtlpDecodeError(`invalid ${String(bytes)}-byte id: ${JSON.stringify(value)}`);
}

function toKind(kind: number | string | undefined): OtelSpan['kind'] {
  if (typeof kind === 'number') return SPAN_KINDS[kind] ?? 'unspecified';
  return SPAN_KINDS.find((name) => `SPAN_KIND_${name.toUpperCase()}` === kind) ?? 'unspecified';
}

function toStatusCode(code: number | string | undefined): OtelSpan['status']['code'] {
  if (typeof code === 'number') return STATUS_CODES[code] ?? 'unset';
  return STATUS_CODES.find((name) => `STATUS_CODE_${name.toUpperCase()}` === code) ?? 'unset';
}

const toNanoString = (value: string | number): string =>
  typeof value === 'number' ? BigInt(value).toString() : value;

export function toOtelSpans(request: unknown): OtelSpan[] {
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success)
    throw new OtlpDecodeError(
      `invalid ExportTraceServiceRequest: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  const spans: OtelSpan[] = [];
  for (const resourceSpans of parsed.data.resourceSpans) {
    const resource = toAttributes(resourceSpans.resource?.attributes ?? []);
    for (const scopeSpans of resourceSpans.scopeSpans) {
      for (const span of scopeSpans.spans) {
        const parentSpanId =
          span.parentSpanId === undefined || span.parentSpanId.length === 0
            ? undefined
            : toHexId(span.parentSpanId, 8);
        const status: OtelSpan['status'] = { code: toStatusCode(span.status.code) };
        if (span.status.message !== undefined && span.status.message !== '')
          status.message = span.status.message;
        const candidate: OtelSpan = {
          traceId: toHexId(span.traceId, 16),
          spanId: toHexId(span.spanId, 8),
          name: span.name,
          kind: toKind(span.kind),
          startUnixNano: toNanoString(span.startTimeUnixNano),
          endUnixNano: toNanoString(span.endTimeUnixNano),
          attributes: toAttributes(span.attributes),
          resource,
          status,
        };
        if (parentSpanId !== undefined) candidate.parentSpanId = parentSpanId;
        const checked = otelSpanSchema.safeParse(candidate);
        if (!checked.success)
          throw new OtlpDecodeError(
            `invalid span ${candidate.spanId}: ${checked.error.issues[0]?.message ?? 'unknown'}`,
          );
        spans.push(checked.data);
      }
    }
  }
  return spans;
}

export function decodeJsonTraces(body: unknown): OtelSpan[] {
  return toOtelSpans(body);
}

export function decodeProtobufTraces(body: Uint8Array): OtelSpan[] {
  let message: protobufjs.Message;
  try {
    message = ExportTraceServiceRequest.decode(body);
  } catch (error) {
    throw new OtlpDecodeError(
      `invalid protobuf: ${error instanceof Error ? error.message : 'unknown'}`,
    );
  }
  const object = ExportTraceServiceRequest.toObject(message, {
    longs: String,
    enums: Number,
    defaults: false,
  });
  return toOtelSpans(object);
}
