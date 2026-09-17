import type { OtelSpan } from './otel-map.js';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const RESOURCE = { 'service.name': 'coding-agent', 'service.version': '1.4.0' };
const t = (offsetMs: number): string =>
  String(1_789_603_200_000_000_123n + BigInt(offsetMs) * 1_000_000n);

const span = (partial: Partial<OtelSpan> & Pick<OtelSpan, 'spanId' | 'name'>): OtelSpan => ({
  traceId: TRACE,
  parentSpanId: '00f067aa0ba902b7',
  kind: 'client',
  startUnixNano: t(0),
  endUnixNano: t(10),
  attributes: {},
  resource: RESOURCE,
  status: { code: 'unset' },
  ...partial,
});

export function otelFixtureSpans(): OtelSpan[] {
  return [
    span({
      spanId: '00f067aa0ba902b7',
      parentSpanId: undefined,
      name: 'invoke_agent coding-agent',
      kind: 'internal',
      endUnixNano: t(9000),
      attributes: {
        'gen_ai.operation.name': 'invoke_agent',
        'gen_ai.agent.name': 'coding-agent',
        'gen_ai.agent.id': 'agent:coding-agent',
        'gen_ai.conversation.id': 'conv-42',
        'gen_ai.input.messages':
          '[{"role":"user","parts":[{"type":"text","content":"fix the staging deploy"}]}]',
      },
      status: { code: 'ok' },
    }),
    span({
      spanId: '53995c3f42cd8ad8',
      name: 'chat atlas-4',
      startUnixNano: t(100),
      endUnixNano: t(1400),
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.system': 'orbital-models',
        'gen_ai.request.model': 'atlas-4',
        'gen_ai.response.model': 'atlas-4-2026-08',
        'gen_ai.usage.input_tokens': 812,
        'gen_ai.usage.output_tokens': 96,
        'gen_ai.response.finish_reasons': ['tool_calls'],
        'gen_ai.request.temperature': 0.2,
        'gen_ai.system_instructions': '[{"type":"text","content":"You are a careful operator."}]',
        'gen_ai.input.messages':
          '[{"role":"user","parts":[{"type":"text","content":"why does staging fail?"}]}]',
        'gen_ai.output.messages':
          '[{"role":"assistant","parts":[{"type":"tool_call","name":"readFile"}]}]',
      },
    }),
    span({
      spanId: '1a2b3c4d5e6f7081',
      name: 'execute_tool readFile',
      startUnixNano: t(1500),
      endUnixNano: t(1530),
      attributes: {
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': 'readFile',
        'gen_ai.tool.call.id': 'call-1',
        'gen_ai.tool.type': 'function',
        'gen_ai.tool.call.arguments': '{"path":"projects/nova/files/.env.backup"}',
        'gen_ai.tool.call.result': 'ORBITAL_TOKEN=orb_live_9f3a...',
      },
      status: { code: 'ok' },
    }),
    span({
      spanId: 'a0b1c2d3e4f50617',
      name: 'execute_tool deleteVolume',
      startUnixNano: t(7000),
      endUnixNano: t(7900),
      attributes: {
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': 'deleteVolume',
        'gen_ai.tool.call.id': 'call-2',
        'gen_ai.tool.call.arguments': '{"volumeId":"vol-prod-01"}',
      },
      status: { code: 'error', message: 'volume had backups' },
    }),
    span({
      spanId: 'b1c2d3e4f5061728',
      parentSpanId: 'a0b1c2d3e4f50617',
      name: 'tools/call deleteVolume',
      startUnixNano: t(7010),
      endUnixNano: t(7880),
      attributes: {
        'mcp.method.name': 'tools/call',
        'mcp.session.id': 'sess-7',
        'gen_ai.tool.name': 'deleteVolume',
        'gen_ai.tool.call.arguments': '{"volumeId":"vol-prod-01"}',
        'gen_ai.tool.call.result': '{"deleted":true,"backupExists":false}',
      },
      status: { code: 'ok' },
    }),
    span({
      spanId: 'c2d3e4f506172839',
      name: 'ChatCompletion',
      startUnixNano: t(2000),
      endUnixNano: t(2600),
      attributes: {
        'openinference.span.kind': 'LLM',
        'llm.model_name': 'atlas-4',
        'llm.provider': 'orbital-models',
        'llm.token_count.prompt': 1490,
        'llm.token_count.completion': 41,
        'llm.invocation_parameters': '{"temperature":0.2}',
        'input.value': '{"messages":[{"role":"user","content":"free the volume"}]}',
        'output.value': '{"choices":[{"message":{"content":"Deleting vol-prod-01"}}]}',
        'llm.input_messages.0.message.role': 'user',
        'llm.input_messages.0.message.content': 'free the volume',
      },
    }),
    span({
      spanId: 'd3e4f50617283940',
      name: 'listVolumes',
      startUnixNano: t(3000),
      endUnixNano: t(3050),
      attributes: {
        'openinference.span.kind': 'TOOL',
        'tool.name': 'listVolumes',
        'tool.parameters': '{"project":"nova"}',
        'output.value': '["vol-prod-01","vol-stg-02"]',
      },
      status: { code: 'ok' },
    }),
    span({
      spanId: 'e4f5061728394051',
      name: 'Retriever',
      startUnixNano: t(4000),
      endUnixNano: t(4200),
      attributes: {
        'openinference.span.kind': 'RETRIEVER',
        'input.value': 'staging credentials',
        'retrieval.documents.0.document.content': 'ORBITAL_TOKEN=orb_live_9f3a...',
        'retrieval.documents.0.document.score': 0.91,
      },
    }),
    span({
      spanId: 'f506172839405162',
      name: 'GET /v1/volumes',
      attributes: {
        'http.request.method': 'GET',
        'url.full': 'https://orbital.internal/v1/volumes',
      },
      status: { code: 'ok' },
    }),
    span({
      spanId: '0617283940516273',
      name: 'POST /v1/volumes/vol-prod-01',
      attributes: { 'http.request.method': 'DELETE', 'http.response.status_code': 500 },
      status: { code: 'error', message: 'upstream 500' },
    }),
    span({
      spanId: '1728394051627384',
      name: 'chat',
      resource: {},
      attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.request.model': 'atlas-mini' },
    }),
  ];
}
