import type { OtelAttrValue, OtelSpan } from '@debrief/schema';

type AnyValue = Record<string, unknown>;

const SPAN_KINDS = ['unspecified', 'internal', 'server', 'client', 'producer', 'consumer'] as const;
const STATUS_CODES = ['unset', 'ok', 'error'] as const;

function anyValue(value: OtelAttrValue): AnyValue {
  if (Array.isArray(value)) return { arrayValue: { values: value.map(anyValue) } };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
}

const keyValues = (attrs: Record<string, OtelAttrValue>): AnyValue[] =>
  Object.entries(attrs).map(([key, value]) => ({ key, value: anyValue(value) }));

// OTLP/JSON encoding of spans, used to build request bodies for tests and tooling.
export function toOtlpJson(spans: readonly OtelSpan[]): Record<string, unknown> {
  const byResource = new Map<
    string,
    { resource: Record<string, OtelAttrValue>; spans: OtelSpan[] }
  >();
  for (const span of spans) {
    const key = JSON.stringify(span.resource);
    const group = byResource.get(key) ?? { resource: span.resource, spans: [] };
    group.spans.push(span);
    byResource.set(key, group);
  }
  return {
    resourceSpans: [...byResource.values()].map(({ resource, spans: group }) => ({
      resource: { attributes: keyValues(resource) },
      scopeSpans: [
        {
          scope: { name: 'debrief-fixture' },
          spans: group.map((span) => ({
            traceId: span.traceId,
            spanId: span.spanId,
            ...(span.parentSpanId === undefined ? {} : { parentSpanId: span.parentSpanId }),
            name: span.name,
            kind: SPAN_KINDS.indexOf(span.kind),
            startTimeUnixNano: span.startUnixNano,
            endTimeUnixNano: span.endUnixNano,
            attributes: keyValues(span.attributes),
            status: {
              code: STATUS_CODES.indexOf(span.status.code),
              ...(span.status.message === undefined ? {} : { message: span.status.message }),
            },
          })),
        },
      ],
    })),
  };
}

export function toProtobufObject(json: Record<string, unknown>): Record<string, unknown> {
  const hexToBase64 = (hex: string): string => Buffer.from(hex, 'hex').toString('base64');
  return JSON.parse(
    JSON.stringify(json, (key, value: unknown) =>
      (key === 'traceId' || key === 'spanId' || key === 'parentSpanId') && typeof value === 'string'
        ? hexToBase64(value)
        : value,
    ),
  ) as Record<string, unknown>;
}
