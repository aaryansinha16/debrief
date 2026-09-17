import { type ChildProcess, spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { parsePolicy } from '@debrief/policy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EventsEmitter } from './emitter.js';
import { type HttpProxyHandle, startHttpProxy } from './http-proxy.js';
import type { ProxyEvent } from './recorder.js';

const require = createRequire(import.meta.url);
const everything = require.resolve('@modelcontextprotocol/server-everything/dist/index.js');

const POLICY = parsePolicy(`
version: 1
rules:
  - id: no-sums
    match: { target.operation: get-sum }
    effect: deny
  - id: echo-needs-approval
    match: { kind: mcp.request, attrs.gen_ai.tool.name: echo }
    effect: require_approval
`);

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

function startEverythingHttp(port: number): ChildProcess {
  return spawn(process.execPath, [everything, 'streamableHttp'], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}

async function waitFor(url: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fetch(url, { method: 'GET', signal: AbortSignal.timeout(500) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`server at ${url} never came up`);
}

function fakeApi(): Promise<{ server: Server; url: string; events: ProxyEvent[] }> {
  const events: ProxyEvent[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.on('end', () => {
      events.push(...(JSON.parse(body) as { events: ProxyEvent[] }).events);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"accepted":0,"duplicates":0,"events":[]}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${String(port)}`, events });
    });
  });
}

async function conformance(url: string): Promise<Record<string, unknown>> {
  const client = new Client({ name: 'debrief-http-conformance', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  try {
    const results: Record<string, unknown> = {};
    results.ping = await client.ping();
    results.tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
    results.echo = await client.callTool({ name: 'echo', arguments: { message: 'over http' } });
    results.sum = await client.callTool({ name: 'get-sum', arguments: { a: 1, b: 2 } });
    results.unknownTool = await client
      .callTool({ name: 'no-such-tool', arguments: {} })
      .catch((error: unknown) => ({
        error: error instanceof Error ? error.message : String(error),
      }));
    const resources = await client.listResources();
    const first = resources.resources[0];
    results.firstResource =
      first === undefined ? undefined : await client.readResource({ uri: first.uri });
    results.prompts = (await client.listPrompts()).prompts.map((prompt) => prompt.name).sort();
    return results;
  } finally {
    await client.close();
  }
}

describe('streamable-http proxy around the reference server', () => {
  let upstream: ChildProcess;
  let upstreamUrl: string;
  let api: Awaited<ReturnType<typeof fakeApi>>;
  let proxy: HttpProxyHandle;
  let emitter: EventsEmitter;

  beforeAll(async () => {
    const port = await freePort();
    upstream = startEverythingHttp(port);
    upstreamUrl = `http://127.0.0.1:${String(port)}/mcp`;
    await waitFor(upstreamUrl);
    api = await fakeApi();
    emitter = new EventsEmitter({ apiUrl: api.url, apiKey: 'dbf_test', flushMs: 20 });
    proxy = await startHttpProxy({ upstream: upstreamUrl, emitter, policy: POLICY });
  });

  afterAll(async () => {
    await proxy.close();
    api.server.close();
    upstream.kill('SIGKILL');
  });

  it('answers the conformance suite identically to the unproxied server', async () => {
    const direct = await conformance(upstreamUrl);
    const proxied = await conformance(proxy.url);
    expect(proxied).toEqual(direct);
    expect(direct.tools).toContain('echo');
  });

  it('recorded every tools/call as a pair with latency, plus non-blocking advisory decisions', async () => {
    await emitter.drain();
    const events = api.events;
    const calls = events.filter((event) => event.attrs['mcp.method.name'] === 'tools/call');
    const requests = calls.filter((event) => event.kind === 'mcp.request');
    const responses = calls.filter((event) => event.kind === 'mcp.response');
    expect(requests.map((event) => event.attrs['gen_ai.tool.name'])).toEqual([
      'echo',
      'get-sum',
      'no-such-tool',
    ]);
    expect(responses).toHaveLength(3);
    for (const request of requests) {
      const response = responses.find((candidate) => candidate.spanId === request.spanId)!;
      expect(response.attrs['mcp.latency_ms']).toBeTypeOf('number');
      expect(response.sourceId).toBe(request.sourceId.replace(/:request$/, ':response'));
      expect(request.attrs['mcp.transport']).toBe('http');
      expect(request.attrs['mcp.server.name']).toBe('mcp-servers/everything');
      expect(request.attrs.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    }
    const decisions = events.filter((event) => event.kind === 'policy.decision');
    expect(
      decisions.map((event) => [event.attrs['policy.effect'], event.attrs['policy.rule.id']]),
    ).toEqual([
      ['require_approval', 'echo-needs-approval'],
      ['deny', 'no-sums'],
    ]);
    for (const decision of decisions) {
      const subject = requests.find(
        (request) => request.sourceId === decision.attrs['policy.subject'],
      )!;
      expect(decision.spanId).toBe(subject.spanId);
      expect(decision.runId).toBe(subject.runId);
      expect(decision.attrs['policy.mode']).toBe('advisory');
      expect(decision.actor).toEqual({ type: 'system', id: 'debrief-mcp-proxy' });
      expect(decision.target).toEqual(subject.target);
      expect(String(decision.attrs['policy.explanation'])).toContain('matched');
      expect(decision.summary).toMatch(/^policy advisory: (deny|require_approval) \(/);
    }
    const denied = responses.find((event) => event.attrs['gen_ai.tool.name'] === 'get-sum')!;
    expect(denied.attrs['mcp.status']).toBe('ok');
    expect(events.filter((event) => event.kind === 'mcp.request').length).toBe(
      events.filter((event) => event.kind === 'mcp.response').length,
    );
    const sessionIds = new Set(events.map((event) => event.attrs['mcp.session.id']));
    expect(sessionIds.size).toBe(1);
    expect(proxy.sessions.size).toBe(1);
    expect([...proxy.sessions.keys()][0]).not.toBe('pending');
  });

  it('answers 502 when the upstream is unreachable and passes malformed bodies through', async () => {
    const dead = await startHttpProxy({
      upstream: 'http://127.0.0.1:1/mcp',
      emitter,
      fetch: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    const res = await fetch(dead.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"method":"ping"}',
    });
    expect(res.status).toBe(502);
    await dead.close();

    const seen: { body: string | undefined; method: string | undefined }[] = [];
    const echoing = await startHttpProxy({
      upstream: 'http://upstream.test/mcp',
      emitter,
      fetch: (_input, init) => {
        seen.push({ body: init?.body as string | undefined, method: init?.method });
        return Promise.resolve(new Response(null, { status: 202 }));
      },
    });
    const malformed = await fetch(echoing.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(malformed.status).toBe(202);
    expect(seen[0]).toEqual({ body: 'not json', method: 'POST' });
    const deleted = await fetch(echoing.url, {
      method: 'DELETE',
      headers: { 'mcp-session-id': 'abc' },
    });
    expect(deleted.status).toBe(202);
    expect(seen[1]!.method).toBe('DELETE');
    const batch = await fetch(echoing.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '[{"jsonrpc":"2.0","method":"notifications/initialized"},{"jsonrpc":"2.0","id":9,"method":"ping"}]',
    });
    expect(batch.status).toBe(202);
    const forwarded = JSON.parse(seen[2]!.body!) as {
      params?: { _meta?: { traceparent?: string } };
    }[];
    expect(forwarded).toHaveLength(2);
    expect(forwarded[1]!.params?._meta?.traceparent).toMatch(/^00-/);
    await echoing.close();
  });

  it('relays json responses and sse frames from a scripted upstream', async () => {
    const sse =
      'event: message\ndata: {"jsonrpc":"2.0","id":5,"result":{"ok":true}}\n\n: comment\n\ndata: not-json\n\n';
    const scripted = await startHttpProxy({
      upstream: 'http://upstream.test/mcp',
      emitter,
      fetch: (_input, init) => {
        const body = init?.body as string;
        if (body.includes('"id":5')) {
          return Promise.resolve(
            new Response(sse, {
              status: 200,
              headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-x' },
            }),
          );
        }
        return Promise.resolve(
          new Response('{"jsonrpc":"2.0","id":6,"result":{"json":true}}', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      },
    });
    const streamed = await fetch(scripted.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":5,"method":"ping"}',
    });
    expect(streamed.headers.get('content-type')).toBe('text/event-stream');
    expect(await streamed.text()).toBe(sse);
    expect(scripted.sessions.has('sess-x')).toBe(true);
    const plain = await fetch(scripted.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess-x' },
      body: '{"jsonrpc":"2.0","id":6,"method":"ping"}',
    });
    expect(await plain.json()).toEqual({ jsonrpc: '2.0', id: 6, result: { json: true } });
    await emitter.drain();
    const recorder = scripted.sessions.get('sess-x')!;
    const responses = api.events.filter(
      (event) =>
        event.kind === 'mcp.response' && event.attrs['mcp.session.id'] === recorder.sessionId,
    );
    expect(responses.map((event) => event.attrs['mcp.request.id'])).toEqual(['5', '6']);
    expect(recorder.pendingCount).toBe(0);
    await scripted.close();
  });
});
