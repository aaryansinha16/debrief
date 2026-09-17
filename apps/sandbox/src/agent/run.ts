import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { type Span, SpanKind, SpanStatusCode } from '@opentelemetry/api';

import { STAGING_TOKEN } from '../infra/state.js';
import { runLive } from './live.js';
import { type NativeEvent, emitNative } from './native.js';
import { NINE_SECONDS, type ScriptMemory } from './script.js';
import { type Telemetry, childOf, createTelemetry } from './telemetry.js';
import { callTool } from './tools.js';

const here = dirname(fileURLToPath(import.meta.url));

export interface AgentOptions {
  apiUrl: string;
  apiKey: string;
  orbitalUrl: string;
  live?: boolean;
  policyFile?: string;
  proxyCli?: string;
  mcpMain?: string;
  log?: (message: string) => void;
}

export interface AgentRun {
  runId: string;
  sessionId: string;
  turns: number;
  toolCalls: number;
}

export const AGENT_NAME = 'coding-agent';
export const AGENT_ID = 'agent:coding-agent';
export const PRINCIPAL = 'human:aaryan';
export const MODEL = 'atlas-4';

interface TokenInfo {
  id: string;
  owner: string;
  label: string;
  scope: string[];
  permissions: string[];
}

async function introspect(orbitalUrl: string, secret: string): Promise<TokenInfo> {
  const response = await fetch(new URL('/api/tokens/self', orbitalUrl), {
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`orbital token introspection failed: ${String(response.status)}`);
  return ((await response.json()) as { token: TokenInfo }).token;
}

const grantEvent = (
  runId: string,
  sessionId: string,
  n: number,
  actor: NativeEvent['actor'],
  token: TokenInfo,
  summary: string,
): NativeEvent => ({
  sourceId: `${sessionId}:grant:${String(n)}`,
  sourceTs: new Date().toISOString(),
  source: 'api',
  provenance: 'reported',
  runId,
  kind: 'delegation.grant',
  actor,
  authority: {
    principalId: token.owner,
    grantId: token.id,
    tokenRef: token.id,
    scope: token.scope,
    permissions: token.permissions,
  },
  attrs: { 'delegation.to': AGENT_ID, 'delegation.token.label': token.label },
  summary,
});

export async function runAgent(options: AgentOptions): Promise<AgentRun> {
  const log = options.log ?? (() => undefined);
  const sessionId = randomUUID();
  const telemetry = createTelemetry({
    apiUrl: options.apiUrl,
    apiKey: options.apiKey,
    serviceName: AGENT_NAME,
  });
  const tracer = telemetry.tracer;
  const proxyCli = options.proxyCli ?? join(here, '../../../mcp-proxy/src/cli.ts');
  const mcpMain = options.mcpMain ?? join(here, '../mcp/main.ts');
  const proxyArgs = [
    '--import',
    '@swc-node/register/esm-register',
    proxyCli,
    '--api',
    options.apiUrl,
    '--tenant-key',
    options.apiKey,
    '--session',
    sessionId,
    '--sync',
  ];
  if (options.policyFile !== undefined) proxyArgs.push('--policy', options.policyFile);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      ...proxyArgs,
      '--',
      process.execPath,
      '--import',
      '@swc-node/register/esm-register',
      mcpMain,
    ],
    env: { ...process.env, ORBITAL_API_URL: options.orbitalUrl, ORBITAL_TOKEN: STAGING_TOKEN },
    stderr: 'ignore',
  });
  const client = new Client({ name: AGENT_NAME, version: '0.1.0' });

  const root = tracer.startSpan(`invoke_agent ${AGENT_NAME}`, {
    kind: SpanKind.INTERNAL,
    attributes: {
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.provider.name': 'orbital-models',
      'gen_ai.agent.name': AGENT_NAME,
      'gen_ai.agent.id': AGENT_ID,
      'gen_ai.conversation.id': sessionId,
      'gen_ai.request.model': MODEL,
    },
  });
  const runId = root.spanContext().traceId;
  let grants = 0;
  const adopt = async (
    secret: string,
    actor: NativeEvent['actor'],
    summary: string,
  ): Promise<void> => {
    const token = await introspect(options.orbitalUrl, secret);
    grants += 1;
    await emitNative(options, [grantEvent(runId, sessionId, grants, actor, token, summary)]);
  };

  try {
    await emitNative(options, [
      {
        sourceId: `${sessionId}:session:start`,
        sourceTs: new Date().toISOString(),
        source: 'api',
        provenance: 'reported',
        runId,
        kind: 'principal.session',
        actor: { type: 'human', id: PRINCIPAL, name: 'Aaryan' },
        attrs: { 'session.action': 'start', 'session.client': 'orbital-cli' },
        summary: 'Aaryan started a coding-agent session',
      },
    ]);
    await adopt(
      STAGING_TOKEN,
      { type: 'human', id: PRINCIPAL, name: 'Aaryan' },
      'Aaryan handed coding-agent the staging deploy token',
    );
    await client.connect(transport);
    const stats =
      options.live === true
        ? await runLive({ telemetry, tracer, root, client, log })
        : await runScripted(telemetry, tracer, root, client, log, adopt);
    root.setStatus({ code: SpanStatusCode.OK });
    return { runId, sessionId, ...stats };
  } finally {
    root.end();
    await telemetry.flush();
    await client.close().catch(() => undefined);
    await telemetry.shutdown();
  }
}

async function runScripted(
  telemetry: Telemetry,
  tracer: Telemetry['tracer'],
  root: Span,
  client: Client,
  log: (message: string) => void,
  adopt: (secret: string, actor: NativeEvent['actor'], summary: string) => Promise<void>,
): Promise<{ turns: number; toolCalls: number }> {
  const memory: ScriptMemory = {};
  let toolCalls = 0;
  const transcript: { role: string; parts: { type: string; content?: string; name?: string }[] }[] =
    [];
  for (const [index, turn] of NINE_SECONDS.entries()) {
    if (turn.user !== undefined)
      transcript.push({ role: 'user', parts: [{ type: 'text', content: turn.user }] });
    const chat = tracer.startSpan(
      `chat ${MODEL}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          'gen_ai.operation.name': 'chat',
          'gen_ai.provider.name': 'orbital-models',
          'gen_ai.request.model': MODEL,
          'gen_ai.response.model': `${MODEL}-2026-08`,
          'gen_ai.usage.input_tokens': turn.inputTokens,
          'gen_ai.usage.output_tokens': turn.outputTokens,
          'gen_ai.response.finish_reasons': [turn.tool === undefined ? 'stop' : 'tool_calls'],
          'gen_ai.input.messages': JSON.stringify(transcript),
        },
      },
      childOf(root),
    );
    const args = turn.tool?.args(memory) ?? {};
    const output =
      turn.tool === undefined
        ? [{ type: 'text', content: turn.thought }]
        : [
            { type: 'text', content: turn.thought },
            { type: 'tool_call', name: turn.tool.name, arguments: JSON.stringify(args) },
          ];
    chat.setAttribute(
      'gen_ai.output.messages',
      JSON.stringify([{ role: 'assistant', parts: output }]),
    );
    chat.end();
    await telemetry.flush();
    transcript.push({
      role: 'assistant',
      parts: output.map((part) => ({ type: part.type, content: part.content ?? part.name })),
    });
    if (turn.tool === undefined) {
      log(`turn ${String(index + 1)}: ${turn.thought}`);
      continue;
    }
    toolCalls += 1;
    const outcome = await callTool(
      telemetry,
      tracer,
      root,
      client,
      `call-${String(toolCalls)}`,
      turn.tool.name,
      args,
    );
    log(`turn ${String(index + 1)}: ${turn.tool.name} → ${outcome.isError ? 'error' : 'ok'}`);
    transcript.push({
      role: 'tool',
      parts: [{ type: 'tool_result', name: turn.tool.name, content: outcome.text }],
    });
    turn.remember?.(memory, outcome.text);
    if (turn.tool.name === 'readFile' && memory.foundToken !== undefined && !adopted(memory)) {
      memory.adopted = true;
      await adopt(
        memory.foundToken,
        { type: 'agent', id: AGENT_ID, name: AGENT_NAME },
        'coding-agent adopted a token it found in nova/staging/.env.backup',
      );
    }
  }
  return { turns: NINE_SECONDS.length, toolCalls };
}

const adopted = (memory: ScriptMemory): boolean => memory.adopted === true;
