import { describe, expect, it } from 'vitest';

import type { JsonRpcMessage } from './jsonrpc.js';
import { SessionRecorder } from './recorder.js';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';

function recorder(): { rec: SessionRecorder; tick: (ms: number) => void } {
  let clock = 1000;
  let span = 0;
  const rec = new SessionRecorder({
    sessionId: 'sess-1',
    traceId: TRACE,
    transport: 'stdio',
    now: () => clock,
    iso: () => '2026-09-17T00:00:00.000Z',
    spanId: () => {
      span += 1;
      return span.toString(16).padStart(16, '0');
    },
  });
  return { rec, tick: (ms) => (clock += ms) };
}

const request = (
  id: number | string,
  method: string,
  params?: Record<string, unknown>,
): JsonRpcMessage => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params === undefined ? {} : { params }),
});

describe('SessionRecorder', () => {
  it('records a tools/call as a request/response pair with latency, traceparent and target', () => {
    const { rec, tick } = recorder();
    const init = rec.onClientMessage(
      request(0, 'initialize', { clientInfo: { name: 'coding-agent', version: '1' } }),
    );
    expect(init.events).toHaveLength(1);
    rec.onServerMessage({ jsonrpc: '2.0', id: 0, result: { serverInfo: { name: 'orbital-mcp' } } });

    const call = rec.onClientMessage(
      request(7, 'tools/call', {
        name: 'deleteVolume',
        arguments: { volumeId: 'vol-prod-01', token: 'orb_live_9f3aQ7xLm2' },
      }),
    );
    const forwarded = call.forward.params as { _meta: { traceparent: string }; arguments: unknown };
    expect(forwarded._meta.traceparent).toBe(`00-${TRACE}-0000000000000002-01`);
    expect(forwarded.arguments).toEqual({ volumeId: 'vol-prod-01', token: 'orb_live_9f3aQ7xLm2' });
    const [req] = call.events;
    expect(req).toMatchObject({
      sourceId: 'sess-1:number:7:request',
      kind: 'mcp.request',
      source: 'mcp-proxy',
      provenance: 'reported',
      runId: TRACE,
      spanId: '0000000000000002',
      actor: { type: 'agent', id: 'coding-agent', name: 'coding-agent' },
      target: { system: 'orbital-mcp', operation: 'deleteVolume' },
      summary: 'mcp tools/call deleteVolume',
    });
    expect(req!.attrs).toMatchObject({
      'mcp.method.name': 'tools/call',
      'mcp.session.id': 'sess-1',
      'mcp.request.id': '7',
      'gen_ai.tool.name': 'deleteVolume',
      'mcp.server.name': 'orbital-mcp',
      'mcp.transport': 'stdio',
      traceparent: `00-${TRACE}-0000000000000002-01`,
    });
    expect(req!.content!['gen_ai.tool.call.arguments']).toMatch(/"token":"\[secret:[0-9a-f]{8}\]"/);
    expect(req).not.toHaveProperty('parentSpanId');
    expect(rec.pendingCount).toBe(1);

    tick(12.5);
    const res = rec.onServerMessage({
      jsonrpc: '2.0',
      id: 7,
      result: { content: [{ type: 'text', text: 'deleted' }] },
    });
    expect(res.forward).toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: { content: [{ type: 'text', text: 'deleted' }] },
    });
    const [rsp] = res.events;
    expect(rsp).toMatchObject({
      sourceId: 'sess-1:number:7:response',
      kind: 'mcp.response',
      runId: TRACE,
      spanId: '0000000000000002',
      target: { system: 'orbital-mcp', operation: 'deleteVolume' },
      summary: 'mcp tools/call deleteVolume → ok (12.5 ms)',
    });
    expect(rsp!.attrs).toMatchObject({
      'mcp.latency_ms': 12.5,
      'mcp.status': 'ok',
      'gen_ai.tool.name': 'deleteVolume',
    });
    expect(rsp!.content).toEqual({
      'gen_ai.tool.call.result': '{"content":[{"type":"text","text":"deleted"}]}',
    });
    expect(rec.pendingCount).toBe(0);
  });

  it('honours an incoming traceparent as parent and keeps its trace id', () => {
    const { rec } = recorder();
    const incoming = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';
    const call = rec.onClientMessage(
      request('r-1', 'resources/read', {
        uri: 'file:///x',
        _meta: { traceparent: incoming, other: 1 },
      }),
    );
    const [req] = call.events;
    expect(req).toMatchObject({
      runId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      parentSpanId: 'bbbbbbbbbbbbbbbb',
      spanId: '0000000000000001',
    });
    const forwarded = call.forward.params as { _meta: Record<string, unknown>; uri: string };
    expect(forwarded._meta).toEqual({
      other: 1,
      traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-0000000000000001-01',
    });
    expect(req!.content).toEqual({ 'mcp.request.params': '{"uri":"file:///x"}' });
    expect(req!.target).toBeUndefined();
    expect(req!.attrs['mcp.request.id']).toBe('r-1');
    const res = rec.onServerMessage({
      jsonrpc: '2.0',
      id: 'r-1',
      error: { code: -32002, message: 'not found' },
    });
    expect(res.events[0]).toMatchObject({
      kind: 'mcp.response',
      summary: 'mcp resources/read → error (0 ms)',
    });
    expect(res.events[0]!.attrs).toMatchObject({
      'mcp.status': 'error',
      'jsonrpc.error.code': -32002,
    });
    expect(res.events[0]!.content).toEqual({
      'mcp.response.error': '{"code":-32002,"message":"not found"}',
    });
  });

  it('marks tool results with isError as error and ignores unknown or invalid traceparents', () => {
    const { rec } = recorder();
    rec.onClientMessage(request(1, 'tools/call', { name: 'x', _meta: { traceparent: 'garbage' } }));
    const res = rec.onServerMessage({
      jsonrpc: '2.0',
      id: 1,
      result: { isError: true, content: [] },
    });
    expect(res.events[0]).toMatchObject({
      runId: TRACE,
      summary: 'mcp tools/call x → error (0 ms)',
    });
    expect(res.events[0]!.attrs['mcp.status']).toBe('error');
    expect(res.events[0]!.content).toEqual({
      'gen_ai.tool.call.result': '{"isError":true,"content":[]}',
    });
  });

  it('forwards notifications, server-initiated requests and unmatched responses untouched', () => {
    const { rec } = recorder();
    const notification: JsonRpcMessage = { jsonrpc: '2.0', method: 'notifications/initialized' };
    expect(rec.onClientMessage(notification)).toEqual({ forward: notification, events: [] });
    const serverRequest: JsonRpcMessage = {
      jsonrpc: '2.0',
      id: 99,
      method: 'sampling/createMessage',
      params: {},
    };
    expect(rec.onServerMessage(serverRequest)).toEqual({ forward: serverRequest, events: [] });
    const stray: JsonRpcMessage = { jsonrpc: '2.0', id: 42, result: {} };
    expect(rec.onServerMessage(stray)).toEqual({ forward: stray, events: [] });
    const clientResponse: JsonRpcMessage = { jsonrpc: '2.0', id: 99, result: { model: 'x' } };
    expect(rec.onClientMessage(clientResponse)).toEqual({ forward: clientResponse, events: [] });
    const nullId: JsonRpcMessage = { jsonrpc: '2.0', id: null, method: 'ping' };
    expect(rec.onClientMessage(nullId).events).toEqual([]);
  });

  it('falls back to a generic actor and mcp system before initialize', () => {
    const { rec } = recorder();
    const [req] = rec.onClientMessage(request(1, 'tools/call', { name: 'echo' })).events;
    expect(req!.actor).toEqual({ type: 'agent', id: 'mcp-client' });
    expect(req!.target).toEqual({ system: 'mcp', operation: 'echo' });
    expect(req!.content).toEqual({ 'gen_ai.tool.call.arguments': '{}' });
    const [rsp] = rec.onServerMessage({ jsonrpc: '2.0', id: 1 }).events;
    expect(rsp!.content).toEqual({ 'gen_ai.tool.call.result': 'null' });
    const noInfo = rec.onClientMessage(request(2, 'initialize', { clientInfo: { name: '' } }));
    expect(noInfo.events[0]!.actor).toEqual({ type: 'agent', id: 'mcp-client' });
    rec.onServerMessage({ jsonrpc: '2.0', id: 2, result: {} });
    expect(rec.onClientMessage(request(3, 'ping')).events[0]!.attrs).not.toHaveProperty(
      'mcp.server.name',
    );
  });

  it('clips long summaries', () => {
    const { rec } = recorder();
    const [req] = rec.onClientMessage(request(1, 'tools/call', { name: 'x'.repeat(400) })).events;
    expect(req!.summary).toHaveLength(280);
  });
});
