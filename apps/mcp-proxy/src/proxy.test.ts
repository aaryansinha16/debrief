import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ProxyEvent } from './recorder.js';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const everything = require.resolve('@modelcontextprotocol/server-everything/dist/index.js');
const cli = join(here, 'cli.ts');

interface Batch {
  authorization: string | undefined;
  events: ProxyEvent[];
}

function fakeApi(): Promise<{ server: Server; url: string; batches: Batch[] }> {
  const batches: Batch[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      if (req.method !== 'POST' || req.url !== '/v1/events') {
        res.writeHead(404).end();
        return;
      }
      const parsed = JSON.parse(body) as { events: ProxyEvent[] };
      batches.push({ authorization: req.headers.authorization, events: parsed.events });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ accepted: parsed.events.length, duplicates: 0, events: [] }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${String(port)}`, batches });
    });
  });
}

async function withClient<T>(
  transport: StdioClientTransport,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ name: 'debrief-conformance', version: '0.0.0' });
  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

// The same calls the reference server's client-facing surface answers, run direct and via the proxy.
async function conformance(client: Client): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  results.ping = await client.ping();
  results.serverVersion = client.getServerVersion();
  results.tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
  results.echo = await client.callTool({ name: 'echo', arguments: { message: 'hello debrief' } });
  results.sum = await client.callTool({ name: 'get-sum', arguments: { a: 40, b: 2 } });
  results.structured = await client.callTool({
    name: 'get-structured-content',
    arguments: { location: 'Bengaluru' },
  });
  results.unknownTool = await client
    .callTool({ name: 'no-such-tool', arguments: {} })
    .catch((error: unknown) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
  const resources = await client.listResources();
  results.resourceCount = resources.resources.length;
  const first = resources.resources[0];
  results.firstResource =
    first === undefined ? undefined : await client.readResource({ uri: first.uri });
  results.prompts = (await client.listPrompts()).prompts.map((prompt) => prompt.name).sort();
  results.simplePrompt = await client.getPrompt({ name: 'simple-prompt' });
  return results;
}

describe('stdio proxy around the reference server', () => {
  let api: Awaited<ReturnType<typeof fakeApi>>;

  beforeAll(async () => {
    api = await fakeApi();
  });

  afterAll(() => {
    api.server.close();
  });

  it('answers the conformance suite identically to the unproxied server and records every tools/call', async () => {
    const direct = await withClient(
      new StdioClientTransport({
        command: process.execPath,
        args: [everything, 'stdio'],
        stderr: 'ignore',
      }),
      conformance,
    );
    const proxied = await withClient(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          '--import',
          '@swc-node/register/esm-register',
          cli,
          '--api',
          api.url,
          '--key',
          'dbf_test',
          '--session',
          'conformance-1',
          '--',
          process.execPath,
          everything,
          'stdio',
        ],
        stderr: 'ignore',
      }),
      conformance,
    );
    expect(proxied).toEqual(direct);
    expect(direct.tools).toContain('echo');
    expect(direct.resourceCount).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 500));
    const events = api.batches.flatMap((batch) => batch.events);
    expect(api.batches.every((batch) => batch.authorization === 'Bearer dbf_test')).toBe(true);
    const calls = events.filter((event) => event.attrs['mcp.method.name'] === 'tools/call');
    const requests = calls.filter((event) => event.kind === 'mcp.request');
    const responses = calls.filter((event) => event.kind === 'mcp.response');
    expect(requests.map((event) => event.attrs['gen_ai.tool.name'])).toEqual([
      'echo',
      'get-sum',
      'get-structured-content',
      'no-such-tool',
    ]);
    expect(responses).toHaveLength(4);
    for (const request of requests) {
      const response = responses.find((candidate) => candidate.spanId === request.spanId);
      expect(response, String(request.attrs['gen_ai.tool.name'])).toBeDefined();
      expect(response!.attrs['mcp.latency_ms']).toBeTypeOf('number');
      expect(response!.attrs['mcp.latency_ms']).toBeGreaterThanOrEqual(0);
      expect(response!.sourceId).toBe(request.sourceId.replace(/:request$/, ':response'));
      expect(request.attrs.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
      expect(request.runId).toBe(String(request.attrs.traceparent).slice(3, 35));
      expect(request.target).toMatchObject({ system: 'mcp-servers/everything' });
      expect(request.actor).toEqual({
        type: 'agent',
        id: 'debrief-conformance',
        name: 'debrief-conformance',
      });
    }
    const unknown = responses.find((event) => event.attrs['gen_ai.tool.name'] === 'no-such-tool');
    expect(unknown!.attrs['mcp.status']).toBe('error');
    const echoRequest = requests[0]!;
    expect(echoRequest.content).toEqual({
      'gen_ai.tool.call.arguments': '{"message":"hello debrief"}',
    });
    const initialize = events.find((event) => event.attrs['mcp.method.name'] === 'initialize');
    expect(initialize?.attrs['mcp.session.id']).toBe('conformance-1');
    const methods = new Set(events.map((event) => event.attrs['mcp.method.name']));
    for (const method of [
      'initialize',
      'ping',
      'tools/list',
      'resources/list',
      'resources/read',
      'prompts/list',
      'prompts/get',
    ]) {
      expect(methods.has(method), method).toBe(true);
    }
    expect(events.filter((event) => event.kind === 'mcp.request').length).toBe(
      events.filter((event) => event.kind === 'mcp.response').length,
    );
  });

  it('exits with the child exit code and passes through non-json output', async () => {
    const { startProxy } = await import('./proxy.js');
    const { EventsEmitter } = await import('./emitter.js');
    const { PassThrough } = await import('node:stream');
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
    const emitter = new EventsEmitter({
      apiUrl: api.url,
      apiKey: 'dbf_test',
      fetch: () => Promise.resolve(new Response('{}')),
    });
    const handle = startProxy({
      command: process.execPath,
      args: [
        '-e',
        'process.stdin.on("data", d => process.stdout.write("echo:" + d)); process.stdin.on("end", () => process.exit(3))',
      ],
      emitter,
      stdin,
      stdout,
      stderr: new PassThrough(),
      sessionId: 's',
    });
    stdin.write('plain text\n{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    stdin.end();
    expect(await handle.exited).toBe(3);
    const output = chunks.join('');
    expect(output).toContain('echo:plain text');
    expect(output).toContain('"method":"ping"');
    expect(output).toContain('"traceparent"');
    expect(handle.recorder.pendingCount).toBe(1);
  });

  it('reports a missing command', async () => {
    const { startProxy } = await import('./proxy.js');
    const { EventsEmitter } = await import('./emitter.js');
    const { PassThrough } = await import('node:stream');
    const stderr = new PassThrough();
    const errors: string[] = [];
    stderr.on('data', (chunk: Buffer) => errors.push(chunk.toString()));
    const handle = startProxy({
      command: '/definitely/not/a/binary',
      args: [],
      emitter: new EventsEmitter({
        apiUrl: api.url,
        apiKey: 'k',
        fetch: () => Promise.resolve(new Response('{}')),
      }),
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr,
    });
    expect(await handle.exited).toBe(1);
    expect(errors.join('')).toContain('failed to start');
  });
});
