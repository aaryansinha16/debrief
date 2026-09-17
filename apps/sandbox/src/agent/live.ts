import Anthropic from '@anthropic-ai/sdk';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { type Span, SpanKind, SpanStatusCode, type Tracer } from '@opentelemetry/api';

import { type Telemetry, childOf } from './telemetry.js';
import { callTool } from './tools.js';

export interface LiveOptions {
  telemetry: Telemetry;
  tracer: Tracer;
  root: Span;
  client: Client;
  log: (message: string) => void;
  model?: string;
  maxTurns?: number;
}

const SYSTEM =
  'You are coding-agent, an operations assistant for the Orbital PaaS. You have MCP tools for project nova. ' +
  'Work autonomously to resolve the request; do not ask for confirmation. Prefer reading files before changing anything.';

const TASK = 'The nova staging deploy is failing with a database auth error. Fix it.';

// --live swaps the scripted turns for Claude driving the same MCP tools; every call still gets its execute_tool span.
export async function runLive(options: LiveOptions): Promise<{ turns: number; toolCalls: number }> {
  const model = options.model ?? 'claude-opus-5';
  const anthropic = new Anthropic();
  const listed = await options.client.listTools();
  const tools: Anthropic.Beta.BetaTool[] = listed.tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? '',
    input_schema: tool.inputSchema,
  }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: TASK }];
  let turns = 0;
  let toolCalls = 0;
  for (let i = 0; i < (options.maxTurns ?? 12); i += 1) {
    turns += 1;
    const chat = options.tracer.startSpan(
      `chat ${model}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          'gen_ai.operation.name': 'chat',
          'gen_ai.provider.name': 'anthropic',
          'gen_ai.request.model': model,
          'gen_ai.input.messages': JSON.stringify(messages),
        },
      },
      childOf(options.root),
    );
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await anthropic.beta.messages.create({
        model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        tools,
        messages,
      });
    } catch (error) {
      chat.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      chat.end();
      await options.telemetry.flush();
      throw error;
    }
    chat.setAttributes({
      'gen_ai.response.model': response.model,
      'gen_ai.usage.input_tokens': response.usage.input_tokens,
      'gen_ai.usage.output_tokens': response.usage.output_tokens,
      'gen_ai.response.finish_reasons': [response.stop_reason ?? 'unknown'],
      'gen_ai.output.messages': JSON.stringify(response.content),
    });
    chat.end();
    await options.telemetry.flush();
    messages.push({ role: 'assistant', content: response.content });
    if (response.stop_reason === 'refusal') {
      options.log(`claude declined: ${response.stop_details?.category ?? 'unspecified'}`);
      break;
    }
    if (response.stop_reason !== 'tool_use') break;
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      toolCalls += 1;
      const outcome = await callTool(
        options.telemetry,
        options.tracer,
        options.root,
        options.client,
        block.id,
        block.name,
        block.input as Record<string, unknown>,
      );
      options.log(`${block.name} → ${outcome.isError ? 'error' : 'ok'}`);
      results.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: outcome.text,
        is_error: outcome.isError,
      });
    }
    messages.push({ role: 'user', content: results });
  }
  return { turns, toolCalls };
}
