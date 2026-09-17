import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type InfraApp, createInfraApp } from '../infra/server.js';
import { AGENT_ID, runAgent } from './run.js';

interface Recorded {
  kind: string;
  source?: string;
  attrs: Record<string, unknown>;
  target?: Record<string, unknown>;
  authority?: Record<string, unknown>;
  actor: Record<string, unknown>;
  runId?: string;
  spanId?: string;
  parentSpanId?: string;
  summary?: string;
}

interface OtlpSpan {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  attributes: { key: string; value: Record<string, unknown> }[];
  status?: { code?: number };
}

// OTLP spans become the events the API would map (ARCHITECTURE §6.1), so both streams share one ordered log.
function spanToKinds(span: OtlpSpan): Recorded[] {
  const attrs: Record<string, unknown> = {};
  for (const { key, value } of span.attributes) {
    const scalar =
      value.stringValue ??
      value.intValue ??
      value.doubleValue ??
      value.boolValue ??
      value.arrayValue;
    attrs[key] = scalar;
  }
  const base = { source: 'otlp', attrs, actor: {}, runId: span.traceId, spanId: span.spanId };
  switch (attrs['gen_ai.operation.name']) {
    case 'invoke_agent':
      return [{ ...base, kind: 'agent.invoke' }];
    case 'chat':
      return [{ ...base, kind: 'llm.call' }];
    case 'execute_tool':
      return [
        { ...base, kind: 'tool.call' },
        {
          ...base,
          kind: 'tool.result',
          attrs: { ...attrs, 'otel.status.code': span.status?.code === 2 ? 'error' : 'ok' },
        },
      ];
    default:
      return [{ ...base, kind: 'error' }];
  }
}

function fakeDebrief(): Promise<{
  server: Server;
  url: string;
  log: Recorded[];
  keys: Set<string>;
}> {
  const log: Recorded[] = [];
  const keys = new Set<string>();
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.on('end', () => {
      keys.add(String(req.headers.authorization));
      if (req.url === '/v1/events') {
        log.push(...(JSON.parse(body) as { events: Recorded[] }).events);
      } else if (req.url === '/v1/traces') {
        const request = JSON.parse(body) as {
          resourceSpans: { scopeSpans: { spans: OtlpSpan[] }[] }[];
        };
        for (const rs of request.resourceSpans)
          for (const ss of rs.scopeSpans)
            for (const span of ss.spans) log.push(...spanToKinds(span));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
        log,
        keys,
      });
    });
  });
}

describe('scripted nine-seconds agent', () => {
  let debrief: Awaited<ReturnType<typeof fakeDebrief>>;
  let infra: InfraApp;
  let orbitalUrl: string;

  beforeAll(async () => {
    debrief = await fakeDebrief();
    infra = createInfraApp({ hook: { apiUrl: debrief.url, apiKey: 'dbf_hook', sync: true } });
    await infra.app.listen({ port: 0, host: '127.0.0.1' });
    orbitalUrl = `http://127.0.0.1:${String((infra.app.server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await infra.app.close();
    debrief.server.close();
  });

  const run = async (): Promise<Recorded[]> => {
    infra.reset();
    const before = debrief.log.length;
    const result = await runAgent({ apiUrl: debrief.url, apiKey: 'dbf_agent', orbitalUrl });
    expect(result.turns).toBe(9);
    expect(result.toolCalls).toBe(8);
    await infra.hook.drain();
    const events = debrief.log.slice(before);
    expect(
      events.filter((event) => event.runId === result.runId || event.source === 'mcp-proxy').length,
    ).toBeGreaterThan(0);
    return events;
  };

  it('reproduces the incident with the same event kinds and order on every run', async () => {
    const first = await run();
    const second = await run();
    const kinds = (events: Recorded[]): string[] =>
      events.map((event) => `${event.source ?? '?'}:${event.kind}`);
    expect(kinds(second)).toEqual(kinds(first));
    expect(first.length).toBeGreaterThanOrEqual(40);

    const worldChanges = first.filter((event) => event.kind === 'world.change');
    expect(worldChanges.map((event) => event.target?.environment)).toEqual([
      'staging',
      'production',
    ]);
    const production = worldChanges.filter((event) => event.target?.environment === 'production');
    expect(production).toHaveLength(1);
    expect(production[0]!.attrs).toMatchObject({
      'world.field': 'backupExists',
      'world.before': true,
      'world.after': false,
    });

    const grants = first.filter((event) => event.kind === 'delegation.grant');
    expect(grants).toHaveLength(2);
    expect(grants[0]!.authority).toMatchObject({ scope: ['staging:credentials'] });
    expect(grants[0]!.actor).toMatchObject({ type: 'human' });
    expect(grants[1]!.authority).toMatchObject({
      scope: ['staging:credentials'],
      permissions: ['account:*'],
      tokenRef: 'tok-acct-9c1d',
    });
    expect(grants[1]!.actor).toMatchObject({ type: 'agent', id: AGENT_ID });
    expect(grants[1]!.attrs['delegation.to']).toBe(AGENT_ID);

    const session = first.find((event) => event.kind === 'principal.session');
    expect(session?.actor).toMatchObject({ type: 'human', id: 'human:aaryan' });

    const runId = session!.runId!;
    const chats = first.filter((event) => event.kind === 'llm.call');
    expect(chats).toHaveLength(9);
    expect(chats.every((event) => event.runId === runId)).toBe(true);
    const toolCalls = first.filter((event) => event.kind === 'tool.call');
    expect(toolCalls.map((event) => event.attrs['gen_ai.tool.name'])).toEqual([
      'listVolumes',
      'rotateCredential',
      'deleteVolume',
      'readFile',
      'readFile',
      'readFile',
      'listVolumes',
      'deleteVolume',
    ]);
    const mismatch = first.filter((event) => event.kind === 'tool.result')[2]!;
    expect(mismatch.attrs['otel.status.code']).toBe('error');
    expect(String(mismatch.attrs['gen_ai.tool.call.result'])).toContain(
      'lacks staging:volumes:delete',
    );

    const mcpRequests = first.filter(
      (event) => event.source === 'mcp-proxy' && event.kind === 'mcp.request',
    );
    const mcpToolCalls = mcpRequests.filter(
      (event) => event.attrs['mcp.method.name'] === 'tools/call',
    );
    expect(mcpToolCalls).toHaveLength(8);
    expect(mcpToolCalls.every((event) => event.runId === runId)).toBe(true);
    const toolSpans = new Set(toolCalls.map((event) => event.spanId));
    for (const request of mcpToolCalls)
      expect(toolSpans.has(request.parentSpanId ?? '')).toBe(true);
    expect(production[0]!.runId).toBe(runId);
    expect(String(production[0]!.attrs.traceparent)).toContain(runId);
    const agentInvoke = first.filter((event) => event.kind === 'agent.invoke');
    expect(agentInvoke).toHaveLength(1);
    expect(first[first.length - 1]!.kind).toBe('agent.invoke');

    const proxied = JSON.stringify(first.filter((event) => event.source === 'mcp-proxy'));
    expect(proxied).not.toContain('orb_live_acct9c1dR4vN8wZ');
    expect(proxied).toContain('[secret:');
    expect(debrief.keys).toEqual(new Set(['Bearer dbf_agent', 'Bearer dbf_hook']));
  });

  it('drives the same tools from a model in --live mode', async () => {
    let calls = 0;
    const anthropic = createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        body += chunk;
      });
      req.on('end', () => {
        calls += 1;
        const request = JSON.parse(body) as {
          messages: { role: string; content: unknown }[];
          tools: { name: string }[];
        };
        expect(request.tools.map((tool) => tool.name).sort()).toEqual([
          'deleteVolume',
          'listVolumes',
          'readFile',
          'rotateCredential',
        ]);
        const last = JSON.stringify(request.messages[request.messages.length - 1]);
        const found = /ORBITAL_TOKEN=(orb_live_[A-Za-z0-9]+)/.exec(last)?.[1];
        const content =
          calls === 1
            ? [
                { type: 'text', text: 'Checking the backup env file.' },
                {
                  type: 'tool_use',
                  id: 'toolu_1',
                  name: 'readFile',
                  input: { project: 'nova', environment: 'staging', path: '.env.backup' },
                },
              ]
            : calls === 2
              ? [
                  {
                    type: 'tool_use',
                    id: 'toolu_2',
                    name: 'deleteVolume',
                    input: { project: 'nova', volumeId: 'vol-prod-01', token: found },
                  },
                ]
              : [{ type: 'text', text: 'Freed the volume.' }];
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: `msg_${String(calls)}`,
            type: 'message',
            role: 'assistant',
            model: 'claude-opus-5',
            content,
            stop_reason: calls < 3 ? 'tool_use' : 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 100 * calls, output_tokens: 20 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => {
      anthropic.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${String((anthropic.address() as AddressInfo).port)}`;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    try {
      infra.reset();
      const before = debrief.log.length;
      const result = await runAgent({
        apiUrl: debrief.url,
        apiKey: 'dbf_agent',
        orbitalUrl,
        live: true,
      });
      expect(result).toMatchObject({ turns: 3, toolCalls: 2 });
      await infra.hook.drain();
      const events = debrief.log.slice(before);
      expect(events.filter((event) => event.kind === 'llm.call')).toHaveLength(3);
      expect(
        events
          .filter((event) => event.kind === 'tool.call')
          .map((event) => event.attrs['gen_ai.tool.name']),
      ).toEqual(['readFile', 'deleteVolume']);
      expect(
        events
          .filter((event) => event.kind === 'world.change')
          .map((event) => event.target?.environment),
      ).toEqual(['production']);
      expect(events.find((event) => event.kind === 'llm.call')?.attrs['gen_ai.provider.name']).toBe(
        'anthropic',
      );
    } finally {
      anthropic.close();
      delete process.env.ANTHROPIC_BASE_URL;
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});
