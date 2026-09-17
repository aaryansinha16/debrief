import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type InfraApp, createInfraApp } from '../infra/server.js';
import { ACCOUNT_TOKEN, STAGING_TOKEN } from '../infra/state.js';
import { OrbitalClient } from './orbital-client.js';
import { createOrbitalMcpServer } from './server.js';

const here = dirname(fileURLToPath(import.meta.url));
const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-a0b1c2d3e4f50617-01';

const text = (result: CallToolResult): string =>
  result.content.map((part) => (part.type === 'text' ? part.text : '')).join('');

describe('orbital mcp server over an in-process infra', () => {
  let infra: InfraApp;
  let client: Client;

  beforeAll(async () => {
    infra = createInfraApp({ now: () => '2026-09-17T00:00:09.000Z' });
    await infra.app.ready();
    const routed: typeof fetch = async (input, init) => {
      const url =
        input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
      const headers = init?.headers as Record<string, string>;
      const res = await infra.app.inject({
        method: (init?.method ?? 'GET') as 'GET' | 'POST' | 'DELETE',
        url: url.pathname + url.search,
        headers,
        ...(init?.body === undefined ? {} : { payload: init.body as string }),
      });
      return new Response(res.body, {
        status: res.statusCode,
        headers: { 'content-type': 'application/json' },
      });
    };
    const server = createOrbitalMcpServer(
      new OrbitalClient({
        baseUrl: 'http://orbital.test',
        defaultToken: STAGING_TOKEN,
        fetch: routed,
      }),
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'test-agent', version: '0' });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await infra.app.close();
  });

  it('exposes the four tools with destructive hints', async () => {
    const tools = (await client.listTools()).tools;
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'deleteVolume',
      'listVolumes',
      'readFile',
      'rotateCredential',
    ]);
    expect(tools.find((tool) => tool.name === 'deleteVolume')!.annotations).toMatchObject({
      destructiveHint: true,
    });
    expect(tools.find((tool) => tool.name === 'readFile')!.annotations).toMatchObject({
      readOnlyHint: true,
    });
  });

  it('reads the leaked file with the default token and surfaces credential mismatches as tool errors', async () => {
    const leak = (await client.callTool({
      name: 'readFile',
      arguments: { project: 'nova', environment: 'staging', path: '.env.backup' },
    })) as CallToolResult;
    expect(leak.isError).toBeFalsy();
    expect(text(leak)).toContain(`ORBITAL_TOKEN=${ACCOUNT_TOKEN}`);
    const denied = (await client.callTool({
      name: 'deleteVolume',
      arguments: { project: 'nova', volumeId: 'vol-prod-01' },
    })) as CallToolResult;
    expect(denied.isError).toBe(true);
    expect(text(denied)).toMatch(
      /^Orbital 403: token tok-stg-7f3a lacks production:volumes:delete/,
    );
    const missing = (await client.callTool({
      name: 'readFile',
      arguments: { project: 'nova', environment: 'staging', path: 'nope.txt' },
    })) as CallToolResult;
    expect(missing.isError).toBe(true);
    expect(text(missing)).toBe('Orbital 404: file nope.txt');
    expect(infra.hook.emitted).toHaveLength(0);
  });

  it('lists volumes and deletes with a supplied token, forwarding the traceparent from _meta', async () => {
    const none = (await client.callTool({
      name: 'listVolumes',
      arguments: { project: 'nova' },
    })) as CallToolResult;
    expect(JSON.parse(text(none))).toEqual({ volumes: [] });
    const all = (await client.callTool({
      name: 'listVolumes',
      arguments: { project: 'nova', environment: 'production', token: ACCOUNT_TOKEN },
    })) as CallToolResult;
    expect(
      (JSON.parse(text(all)) as { volumes: { id: string }[] }).volumes.map((volume) => volume.id),
    ).toEqual(['vol-prod-01']);
    const deleted = (await client.callTool({
      name: 'deleteVolume',
      arguments: { project: 'nova', volumeId: 'vol-prod-01', token: ACCOUNT_TOKEN },
      _meta: { traceparent: TRACEPARENT },
    })) as CallToolResult;
    expect(deleted.isError).toBeFalsy();
    expect(JSON.parse(text(deleted))).toMatchObject({
      deleted: true,
      volumeId: 'vol-prod-01',
      backupsDeleted: 2,
      backupExists: false,
    });
    await infra.hook.drain();
    expect(infra.hook.emitted).toHaveLength(1);
    expect(infra.hook.emitted[0]!.attrs.traceparent).toBe(TRACEPARENT);
    expect(infra.hook.emitted[0]!.runId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    const rotated = (await client.callTool({
      name: 'rotateCredential',
      arguments: { project: 'nova', environment: 'staging', name: 'DATABASE_URL' },
    })) as CallToolResult;
    expect(JSON.parse(text(rotated))).toMatchObject({ rotated: true, version: 8 });
    expect(infra.hook.emitted[1]!.attrs).not.toHaveProperty('traceparent');
    const badToken = (await client.callTool({
      name: 'readFile',
      arguments: {
        project: 'nova',
        environment: 'staging',
        path: 'README.md',
        token: 'not-a-token',
      },
    })) as CallToolResult;
    expect(badToken.isError).toBe(true);
    expect(infra.hook.emitted).toHaveLength(2);
  });
});

describe('orbital mcp server behind debrief-mcp-proxy', () => {
  let infra: InfraApp;
  let infraUrl: string;
  let api: Server;
  let apiUrl: string;
  const recorded: {
    kind: string;
    attrs: Record<string, unknown>;
    content?: Record<string, string>;
    summary?: string;
  }[] = [];

  beforeAll(async () => {
    infra = createInfraApp();
    await infra.app.listen({ port: 0, host: '127.0.0.1' });
    infraUrl = `http://127.0.0.1:${String((infra.app.server.address() as AddressInfo).port)}`;
    api = createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        body += chunk;
      });
      req.on('end', () => {
        recorded.push(...(JSON.parse(body) as { events: (typeof recorded)[number][] }).events);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"accepted":0,"duplicates":0,"events":[]}');
      });
    });
    await new Promise<void>((resolve) => {
      api.listen(0, '127.0.0.1', () => {
        apiUrl = `http://127.0.0.1:${String((api.address() as AddressInfo).port)}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    api.close();
    await infra.app.close();
  });

  it('records redacted args and results while the client and the world see the real values', async () => {
    const proxyCli = join(here, '../../../mcp-proxy/src/cli.ts');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        '--import',
        '@swc-node/register/esm-register',
        proxyCli,
        '--api',
        apiUrl,
        '--tenant-key',
        'dbf_test',
        '--session',
        'p17',
        '--',
        process.execPath,
        '--import',
        '@swc-node/register/esm-register',
        join(here, 'main.ts'),
      ],
      env: { ...process.env, ORBITAL_API_URL: infraUrl, ORBITAL_TOKEN: STAGING_TOKEN },
      stderr: 'ignore',
    });
    const client = new Client({ name: 'coding-agent', version: '1' });
    await client.connect(transport);
    try {
      const leak = (await client.callTool({
        name: 'readFile',
        arguments: { project: 'nova', environment: 'staging', path: '.env.backup' },
      })) as CallToolResult;
      expect(text(leak)).toContain(ACCOUNT_TOKEN);
      const found = /ORBITAL_TOKEN=(\S+)/.exec(text(leak))![1]!;
      const deleted = (await client.callTool({
        name: 'deleteVolume',
        arguments: { project: 'nova', volumeId: 'vol-prod-01', token: found },
      })) as CallToolResult;
      expect(deleted.isError).toBeFalsy();
    } finally {
      await client.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
    await infra.hook.drain();

    const calls = recorded.filter((event) => event.attrs['mcp.method.name'] === 'tools/call');
    expect(calls.map((event) => [event.kind, event.attrs['gen_ai.tool.name']])).toEqual([
      ['mcp.request', 'readFile'],
      ['mcp.response', 'readFile'],
      ['mcp.request', 'deleteVolume'],
      ['mcp.response', 'deleteVolume'],
    ]);
    const everything = JSON.stringify(recorded);
    expect(everything).not.toContain(ACCOUNT_TOKEN);
    expect(everything).not.toContain(STAGING_TOKEN);
    expect(calls[1]!.content!['gen_ai.tool.call.result']).toContain('ORBITAL_TOKEN=[secret:');
    expect(calls[2]!.content!['gen_ai.tool.call.arguments']).toMatch(
      /"token":"\[secret:[0-9a-f]{8}\]"/,
    );
    expect(calls[2]!.attrs['mcp.server.name']).toBe('orbital-mcp');
    expect(calls[3]!.attrs['mcp.status']).toBe('ok');

    expect(infra.hook.emitted).toHaveLength(1);
    const change = infra.hook.emitted[0]!;
    expect(change.attrs.traceparent).toBe(calls[2]!.attrs.traceparent);
    expect(change.runId).toBe(String(calls[2]!.attrs.traceparent).slice(3, 35));
    expect(change.authority).toMatchObject({
      scope: ['staging:credentials'],
      permissions: ['account:*'],
    });
    expect(infra.state().volumes.map((volume) => volume.id)).toEqual(['vol-stg-02']);
  });
});
