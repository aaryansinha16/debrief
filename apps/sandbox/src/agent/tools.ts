import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { type Span, SpanKind, SpanStatusCode, type Tracer } from '@opentelemetry/api';

import { type Telemetry, childOf } from './telemetry.js';

export interface ToolOutcome {
  text: string;
  isError: boolean;
}

export const resultText = (result: CallToolResult): string =>
  result.content.map((part) => (part.type === 'text' ? part.text : `[${part.type}]`)).join('');

// One execute_tool span per MCP call; the span's traceparent rides in _meta so the proxy and the world hook share the trace.
export async function callTool(
  telemetry: Telemetry,
  tracer: Tracer,
  parent: Span,
  client: Client,
  callId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const span = tracer.startSpan(
    `execute_tool ${name}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': name,
        'gen_ai.tool.call.id': callId,
        'gen_ai.tool.type': 'extension',
        'gen_ai.tool.call.arguments': JSON.stringify(args),
      },
    },
    childOf(parent),
  );
  try {
    const result = (await client.callTool({
      name,
      arguments: args,
      _meta: { traceparent: telemetry.traceparentOf(span) },
    })) as CallToolResult;
    const text = resultText(result);
    const isError = result.isError === true;
    span.setAttribute('gen_ai.tool.call.result', text);
    if (isError) span.setStatus({ code: SpanStatusCode.ERROR, message: text.slice(0, 200) });
    return { text, isError };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message });
    return { text: message, isError: true };
  } finally {
    span.end();
    await telemetry.flush();
  }
}
