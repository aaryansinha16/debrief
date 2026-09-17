import { z } from 'zod';

import type { Actor, AttrValue, Attrs, EventInput, EventKind, Target } from './event.js';

// Attribute names pinned to OpenTelemetry semantic conventions gen-ai/1.42.0; aliases below are normalized to these.
export const GEN_AI_SEMCONV_VERSION = '1.42.0';

export const ATTR = {
  operationName: 'gen_ai.operation.name',
  providerName: 'gen_ai.provider.name',
  requestModel: 'gen_ai.request.model',
  responseModel: 'gen_ai.response.model',
  inputTokens: 'gen_ai.usage.input_tokens',
  outputTokens: 'gen_ai.usage.output_tokens',
  finishReasons: 'gen_ai.response.finish_reasons',
  agentId: 'gen_ai.agent.id',
  agentName: 'gen_ai.agent.name',
  conversationId: 'gen_ai.conversation.id',
  toolName: 'gen_ai.tool.name',
  toolCallId: 'gen_ai.tool.call.id',
  toolType: 'gen_ai.tool.type',
  toolDescription: 'gen_ai.tool.description',
  inputMessages: 'gen_ai.input.messages',
  outputMessages: 'gen_ai.output.messages',
  systemInstructions: 'gen_ai.system_instructions',
  toolCallArguments: 'gen_ai.tool.call.arguments',
  toolCallResult: 'gen_ai.tool.call.result',
  mcpMethodName: 'mcp.method.name',
  mcpSessionId: 'mcp.session.id',
  serviceName: 'service.name',
  openInferenceSpanKind: 'openinference.span.kind',
} as const;

export const ATTRIBUTE_ALIASES: Readonly<Record<string, string>> = {
  'gen_ai.system': ATTR.providerName,
  'gen_ai.usage.prompt_tokens': ATTR.inputTokens,
  'gen_ai.usage.completion_tokens': ATTR.outputTokens,
  'gen_ai.prompt': ATTR.inputMessages,
  'gen_ai.completion': ATTR.outputMessages,
  'llm.model_name': ATTR.requestModel,
  'llm.provider': ATTR.providerName,
  'llm.system': ATTR.providerName,
  'llm.token_count.prompt': ATTR.inputTokens,
  'llm.token_count.completion': ATTR.outputTokens,
  'llm.prompts': ATTR.inputMessages,
  'input.value': ATTR.inputMessages,
  'output.value': ATTR.outputMessages,
  'tool.name': ATTR.toolName,
  'tool.description': ATTR.toolDescription,
  'tool.parameters': ATTR.toolCallArguments,
  'tool_call.id': ATTR.toolCallId,
  'tool_call.function.name': ATTR.toolName,
  'tool_call.function.arguments': ATTR.toolCallArguments,
  'session.id': ATTR.conversationId,
  'agent.name': ATTR.agentName,
};

const CONTENT_ATTRS: ReadonlySet<string> = new Set([
  ATTR.inputMessages,
  ATTR.outputMessages,
  ATTR.systemInstructions,
  ATTR.toolCallArguments,
  ATTR.toolCallResult,
]);

const CONTENT_PREFIXES = [
  'gen_ai.input.',
  'gen_ai.output.',
  'llm.input_messages',
  'llm.output_messages',
  'retrieval.documents',
  'embedding.embeddings',
  'message.',
] as const;

const OPENINFERENCE_OPERATIONS: Readonly<Record<string, string>> = {
  LLM: 'chat',
  TOOL: 'execute_tool',
  AGENT: 'invoke_agent',
  RETRIEVER: 'retrieval',
};

export const captureModeSchema = z.enum(['off', 'summary', 'on']);
export type CaptureMode = z.infer<typeof captureModeSchema>;

export const otelAttrValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
]);
export type OtelAttrValue = z.infer<typeof otelAttrValueSchema>;

export const otelSpanSchema = z.strictObject({
  traceId: z.string().regex(/^[0-9a-f]{32}$/),
  spanId: z.string().regex(/^[0-9a-f]{16}$/),
  parentSpanId: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .optional(),
  name: z.string(),
  kind: z.enum(['unspecified', 'internal', 'server', 'client', 'producer', 'consumer']),
  startUnixNano: z.string().regex(/^\d{1,20}$/),
  endUnixNano: z.string().regex(/^\d{1,20}$/),
  attributes: z.record(z.string(), otelAttrValueSchema),
  resource: z.record(z.string(), otelAttrValueSchema),
  status: z.strictObject({
    code: z.enum(['unset', 'ok', 'error']),
    message: z.string().optional(),
  }),
});
export type OtelSpan = z.infer<typeof otelSpanSchema>;

export type SpanEventInput = Omit<EventInput, 'id' | 'ts' | 'tenantId'>;

export interface SpanEvent {
  sourceId: string;
  input: SpanEventInput;
  content?: Record<string, string>;
}

export type DropReason = 'unknown-operation';

export interface MapResult {
  events: SpanEvent[];
  dropped: Record<DropReason, number>;
}

export interface NormalizedAttributes {
  attrs: Attrs;
  content: Record<string, string>;
}

export function isContentAttribute(name: string): boolean {
  return CONTENT_ATTRS.has(name) || CONTENT_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function toAttrValue(value: OtelAttrValue): AttrValue {
  if (!Array.isArray(value)) return value;
  return value.every((item) => typeof item === 'string') ? value.join(',') : JSON.stringify(value);
}

const OUTPUT_CONTENT_PREFIXES = [
  'gen_ai.output.',
  'llm.output_messages',
  'retrieval.documents',
  'embedding.embeddings',
] as const;

export function isOutputContent(name: string): boolean {
  return (
    name === ATTR.outputMessages ||
    name === ATTR.toolCallResult ||
    OUTPUT_CONTENT_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

export function normalizeAttributes(
  raw: Readonly<Record<string, OtelAttrValue>>,
): NormalizedAttributes {
  const attrs: Attrs = {};
  const content: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(raw)) {
    const name = ATTRIBUTE_ALIASES[rawName] ?? rawName;
    if (isContentAttribute(name)) {
      content[name] = typeof value === 'string' ? value : JSON.stringify(value);
    } else if (!(name in attrs) || name === rawName) {
      attrs[name] = toAttrValue(value);
    }
  }
  return { attrs, content };
}

export function formatUnixNano(unixNano: string): string {
  const nanos = BigInt(unixNano);
  const seconds = nanos / 1_000_000_000n;
  const fraction = (nanos % 1_000_000_000n).toString().padStart(9, '0');
  const base = new Date(Number(seconds) * 1000).toISOString();
  return `${base.slice(0, 19)}.${fraction}Z`;
}

const asString = (value: AttrValue | undefined): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

function operationOf(attrs: Attrs): string | undefined {
  const explicit = asString(attrs[ATTR.operationName]);
  if (explicit !== undefined) return explicit;
  const inferenceKind = asString(attrs[ATTR.openInferenceSpanKind]);
  if (inferenceKind !== undefined) return OPENINFERENCE_OPERATIONS[inferenceKind.toUpperCase()];
  if (asString(attrs[ATTR.mcpMethodName]) !== undefined) return 'mcp';
  return undefined;
}

function actorOf(span: OtelSpan, attrs: Attrs): Actor {
  const service = asString(toAttrValue(span.resource[ATTR.serviceName] ?? ''));
  const name = asString(attrs[ATTR.agentName]) ?? service;
  const id = asString(attrs[ATTR.agentId]) ?? name ?? 'unknown-agent';
  return name === undefined ? { type: 'agent', id } : { type: 'agent', id, name };
}

const clip = (text: string): string => (text.length <= 280 ? text : `${text.slice(0, 279)}…`);

function tokenSummary(attrs: Attrs): string {
  const model =
    asString(attrs[ATTR.responseModel]) ?? asString(attrs[ATTR.requestModel]) ?? 'unknown model';
  const input = attrs[ATTR.inputTokens];
  const output = attrs[ATTR.outputTokens];
  const tokens =
    typeof input === 'number' || typeof output === 'number'
      ? `: ${String(input ?? '?')}→${String(output ?? '?')} tokens`
      : '';
  const finish = asString(attrs[ATTR.finishReasons]);
  return `${model}${tokens}${finish === undefined ? '' : ` (${finish})`}`;
}

type ContentSide = 'all' | 'input' | 'output';

function pick(
  content: Record<string, string>,
  side: ContentSide,
): Record<string, string> | undefined {
  const picked: Record<string, string> = {};
  for (const [key, value] of Object.entries(content)) {
    if (side === 'all' || (side === 'output') === isOutputContent(key)) picked[key] = value;
  }
  return Object.keys(picked).length === 0 ? undefined : picked;
}

interface Builder {
  span: OtelSpan;
  attrs: Attrs;
  content: Record<string, string>;
  capture: CaptureMode;
  actor: Actor;
}

function event(
  b: Builder,
  suffix: string,
  kind: EventKind,
  at: 'start' | 'end',
  summary: string,
  side: ContentSide,
  target?: Target,
): SpanEvent {
  const input: SpanEventInput = {
    sourceTs: formatUnixNano(at === 'start' ? b.span.startUnixNano : b.span.endUnixNano),
    source: 'otlp',
    provenance: 'reported',
    runId: b.span.traceId,
    spanId: b.span.spanId,
    kind,
    actor: b.actor,
    attrs: b.attrs,
    summary: clip(summary),
  };
  if (b.span.parentSpanId !== undefined) input.parentSpanId = b.span.parentSpanId;
  if (target !== undefined) input.target = target;
  const sourceId =
    suffix === ''
      ? `${b.span.traceId}:${b.span.spanId}`
      : `${b.span.traceId}:${b.span.spanId}:${suffix}`;
  const picked = b.capture === 'off' ? undefined : pick(b.content, side);
  return picked === undefined ? { sourceId, input } : { sourceId, input, content: picked };
}

// ARCHITECTURE §6.1
export function mapSpan(span: OtelSpan, capture: CaptureMode): SpanEvent[] | undefined {
  const { attrs: normalized, content } = normalizeAttributes(span.attributes);
  const attrs: Attrs = { ...normalized, 'otel.span.name': span.name, 'otel.span.kind': span.kind };
  const service = span.resource[ATTR.serviceName];
  if (service !== undefined) attrs[ATTR.serviceName] = toAttrValue(service);
  if (span.status.code !== 'unset') attrs['otel.status.code'] = span.status.code;
  const b: Builder = { span, attrs, content, capture, actor: actorOf(span, attrs) };
  const operation = operationOf(attrs);
  const status = span.status.code === 'error' ? 'error' : 'ok';
  switch (operation) {
    case 'invoke_agent':
    case 'create_agent': {
      return [event(b, '', 'agent.invoke', 'start', `${operation} ${b.actor.id}`, 'all')];
    }
    case 'chat':
    case 'text_completion':
    case 'generate_content':
      return [event(b, '', 'llm.call', 'start', `${operation} ${tokenSummary(attrs)}`, 'all')];
    case 'execute_tool':
    case 'retrieval': {
      const name = asString(attrs[ATTR.toolName]) ?? span.name;
      const system =
        operation === 'retrieval' ? 'retriever' : (asString(attrs[ATTR.toolType]) ?? 'tool');
      const target: Target = { system, operation: name };
      return [
        event(b, 'call', 'tool.call', 'start', `${operation} ${name}`, 'input', target),
        event(b, 'result', 'tool.result', 'end', `${name} → ${status}`, 'output', target),
      ];
    }
    case 'mcp': {
      const method = String(attrs[ATTR.mcpMethodName]);
      const tool = asString(attrs[ATTR.toolName]);
      const label = tool === undefined ? method : `${method} ${tool}`;
      return [
        event(b, 'request', 'mcp.request', 'start', `mcp ${label}`, 'input'),
        event(b, 'response', 'mcp.response', 'end', `mcp ${label} → ${status}`, 'output'),
      ];
    }
    default:
      if (status === 'error') return [event(b, '', 'error', 'end', `${span.name} failed`, 'all')];
      return undefined;
  }
}

export function mapSpans(spans: readonly OtelSpan[], capture: CaptureMode): MapResult {
  const result: MapResult = { events: [], dropped: { 'unknown-operation': 0 } };
  for (const span of spans) {
    const mapped = mapSpan(span, capture);
    if (mapped === undefined) result.dropped['unknown-operation'] += 1;
    else result.events.push(...mapped);
  }
  return result;
}
