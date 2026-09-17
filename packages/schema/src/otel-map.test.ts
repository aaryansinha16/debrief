import { describe, expect, it } from 'vitest';

import golden from '../__golden__/otel-map.json';
import { eventInputSchema } from './event.js';
import { otelFixtureSpans } from './otel-fixtures.js';
import {
  ATTR,
  GEN_AI_SEMCONV_VERSION,
  type MapResult,
  type OtelSpan,
  formatUnixNano,
  isContentAttribute,
  mapSpan,
  mapSpans,
  normalizeAttributes,
  otelSpanSchema,
} from './otel-map.js';
import { utcTimestampSchema } from './primitives.js';

const spans = otelSpanSchema.array().parse(golden.spans);
const expected = golden.on as unknown as MapResult;

describe('otel-map golden', () => {
  it('pins the semconv version and the fixture', () => {
    expect(GEN_AI_SEMCONV_VERSION).toBe('1.42.0');
    expect(otelFixtureSpans()).toEqual(spans);
    expect(spans).toHaveLength(11);
  });

  it('maps invoke_agent, chat, execute_tool, MCP and OpenInference spans to the golden events', () => {
    expect(mapSpans(spans, 'on')).toEqual(expected);
    expect(expected.events.map((event) => event.input.kind)).toEqual([
      'agent.invoke',
      'llm.call',
      'tool.call',
      'tool.result',
      'tool.call',
      'tool.result',
      'mcp.request',
      'mcp.response',
      'llm.call',
      'tool.call',
      'tool.result',
      'tool.call',
      'tool.result',
      'error',
      'llm.call',
    ]);
  });

  it('counts unknown spans instead of storing them', () => {
    const result = mapSpans(spans, 'on');
    expect(result.dropped).toEqual({ 'unknown-operation': 1 });
    expect(result.events.some((event) => event.input.spanId === 'f506172839405162')).toBe(false);
    expect(
      result.events
        .filter((event) => event.input.spanId === '0617283940516273')
        .map((e) => e.input.kind),
    ).toEqual(['error']);
  });

  it('carries no content when capture is off', () => {
    const off = mapSpans(spans, 'off');
    expect(off.dropped).toEqual(expected.dropped);
    expect(off.events).toEqual(expected.events.map(({ content: _content, ...rest }) => rest));
    for (const event of off.events) {
      expect(event).not.toHaveProperty('content');
      for (const name of Object.keys(event.input.attrs))
        expect(isContentAttribute(name)).toBe(false);
      expect(JSON.stringify(event.input)).not.toContain('orb_live_9f3a');
    }
  });

  it('carries content for summary mode exactly as for on', () => {
    expect(mapSpans(spans, 'summary')).toEqual(expected);
  });

  it('never leaks content into attrs even when capture is on', () => {
    for (const event of expected.events) {
      for (const name of Object.keys(event.input.attrs))
        expect(isContentAttribute(name)).toBe(false);
      expect(JSON.stringify(event.input)).not.toContain('orb_live_9f3a');
    }
  });

  it('produces schema-valid event inputs with unique source ids', () => {
    const ids = new Set<string>();
    for (const event of expected.events) {
      ids.add(event.sourceId);
      const parsed = eventInputSchema.safeParse({
        ...event.input,
        id: '01J8ZK5R4M2X6P9Q3V7W1Y5N8B',
        ts: '2026-09-17T00:00:00.000Z',
        tenantId: 't',
      });
      expect(parsed.success, event.sourceId).toBe(true);
      expect(event.input.summary!.length).toBeLessThanOrEqual(280);
    }
    expect(ids.size).toBe(expected.events.length);
  });

  it('gives tool spans a target and start/end timestamps', () => {
    const [call, result] = expected.events.filter(
      (event) => event.input.spanId === '1a2b3c4d5e6f7081',
    );
    expect(call!.input.target).toEqual({ system: 'function', operation: 'readFile' });
    expect(result!.input.target).toEqual(call!.input.target);
    expect(call!.input.sourceTs < result!.input.sourceTs).toBe(true);
    expect(call!.input.attrs[ATTR.toolCallId]).toBe('call-1');
  });
});

describe('normalizeAttributes', () => {
  it('renames aliases, strips content, joins string arrays and json-encodes other arrays', () => {
    const { attrs, content } = normalizeAttributes({
      'llm.model_name': 'atlas-4',
      'gen_ai.system': 'orbital-models',
      'gen_ai.response.finish_reasons': ['stop', 'length'],
      scores: [0.5, 1],
      'input.value': 'hello',
      'llm.output_messages.0.message.content': 'hi',
      plain: true,
    });
    expect(attrs).toEqual({
      'gen_ai.request.model': 'atlas-4',
      'gen_ai.provider.name': 'orbital-models',
      'gen_ai.response.finish_reasons': 'stop,length',
      scores: '[0.5,1]',
      plain: true,
    });
    expect(content).toEqual({
      'gen_ai.input.messages': 'hello',
      'llm.output_messages.0.message.content': 'hi',
    });
  });

  it('lets the canonical name win over an alias regardless of order', () => {
    const canonicalFirst = normalizeAttributes({
      'gen_ai.request.model': 'a',
      'llm.model_name': 'b',
    });
    const aliasFirst = normalizeAttributes({ 'llm.model_name': 'b', 'gen_ai.request.model': 'a' });
    expect(canonicalFirst.attrs['gen_ai.request.model']).toBe('a');
    expect(aliasFirst.attrs['gen_ai.request.model']).toBe('a');
  });

  it('stringifies non-string content', () => {
    expect(normalizeAttributes({ 'gen_ai.input.messages': ['a', 'b'] }).content).toEqual({
      'gen_ai.input.messages': '["a","b"]',
    });
  });
});

describe('formatUnixNano', () => {
  it.each([
    ['0', '1970-01-01T00:00:00.000000000Z'],
    ['1', '1970-01-01T00:00:00.000000001Z'],
    ['1789603200000000123', '2026-09-17T00:00:00.000000123Z'],
    ['1789603200999999999', '2026-09-17T00:00:00.999999999Z'],
  ])('formats %s as %s', (nanos, iso) => {
    expect(formatUnixNano(nanos)).toBe(iso);
    expect(utcTimestampSchema.safeParse(iso).success).toBe(true);
  });
});

describe('mapSpan edge cases', () => {
  const base: OtelSpan = spans[0]!;

  it('falls back to the resource service name and then to unknown-agent', () => {
    const noAgent: OtelSpan = { ...base, attributes: { 'gen_ai.operation.name': 'chat' } };
    expect(mapSpan(noAgent, 'off')![0]!.input.actor).toEqual({
      type: 'agent',
      id: 'coding-agent',
      name: 'coding-agent',
    });
    const noService: OtelSpan = { ...noAgent, resource: {} };
    expect(mapSpan(noService, 'off')![0]!.input.actor).toEqual({
      type: 'agent',
      id: 'unknown-agent',
    });
  });

  it('prefers gen_ai.operation.name over openinference and mcp hints', () => {
    const mixed: OtelSpan = {
      ...base,
      attributes: {
        'gen_ai.operation.name': 'execute_tool',
        'openinference.span.kind': 'LLM',
        'mcp.method.name': 'tools/call',
        'gen_ai.tool.name': 'x',
      },
    };
    expect(mapSpan(mixed, 'off')!.map((event) => event.input.kind)).toEqual([
      'tool.call',
      'tool.result',
    ]);
    const unknownKind: OtelSpan = { ...base, attributes: { 'openinference.span.kind': 'CHAIN' } };
    expect(mapSpan(unknownKind, 'off')).toBeUndefined();
    const mcpOnly: OtelSpan = { ...base, attributes: { 'mcp.method.name': 'resources/read' } };
    expect(mapSpan(mcpOnly, 'off')!.map((event) => event.input.summary)).toEqual([
      'mcp resources/read',
      'mcp resources/read → ok',
    ]);
  });

  it('clips summaries to 280 characters and omits the parent when absent', () => {
    const long: OtelSpan = {
      ...base,
      parentSpanId: undefined,
      name: 'x'.repeat(400),
      attributes: {},
      status: { code: 'error' },
    };
    const [event] = mapSpan(long, 'off')!;
    expect(event!.input.summary).toHaveLength(280);
    expect(event!.input).not.toHaveProperty('parentSpanId');
  });

  it('summarizes token usage when only one side is known', () => {
    const partial: OtelSpan = {
      ...base,
      attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.usage.output_tokens': 5 },
    };
    expect(mapSpan(partial, 'off')![0]!.input.summary).toBe('chat unknown model: ?→5 tokens');
    const inputOnly: OtelSpan = {
      ...base,
      attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.usage.input_tokens': 7 },
    };
    expect(mapSpan(inputOnly, 'off')![0]!.input.summary).toBe('chat unknown model: 7→? tokens');
  });
});
