import { type Policy, evaluate } from '@debrief/policy';
import {
  ATTR,
  type Attrs,
  type CaptureMode,
  type EventInput,
  type Target,
  redactSecrets,
} from '@debrief/schema';

import { type JsonRpcId, type JsonRpcMessage, idKey, isRequest, isResponse } from './jsonrpc.js';
import { formatTraceparent, parseTraceparent, randomSpanId } from './traceparent.js';

export type ProxyEvent = Omit<EventInput, 'id' | 'ts' | 'tenantId'> & {
  sourceId: string;
  content?: Record<string, string>;
};

export interface RecorderOptions {
  sessionId: string;
  traceId: string;
  transport: 'stdio' | 'http';
  capture?: CaptureMode;
  policy?: Policy;
  now?: () => number;
  iso?: () => string;
  spanId?: () => string;
}

interface Pending {
  method: string;
  toolName?: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startedAt: number;
}

interface Relay {
  forward: JsonRpcMessage;
  events: ProxyEvent[];
}

const clip = (text: string): string => (text.length <= 280 ? text : `${text.slice(0, 279)}…`);
const safeJson = (value: unknown): string => JSON.stringify(value === undefined ? null : value);

export class SessionRecorder {
  private readonly pending = new Map<string, Pending>();
  private clientName: string | undefined;
  private serverName: string | undefined;
  private readonly now: () => number;
  private readonly iso: () => string;
  private readonly spanId: () => string;

  constructor(private readonly options: RecorderOptions) {
    this.now = options.now ?? (() => performance.now());
    this.iso = options.iso ?? (() => new Date().toISOString());
    this.spanId = options.spanId ?? randomSpanId;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  get sessionId(): string {
    return this.options.sessionId;
  }

  onClientMessage(message: JsonRpcMessage): Relay {
    if (
      !isRequest(message) ||
      message.method === undefined ||
      message.id === undefined ||
      message.id === null
    ) {
      return { forward: message, events: [] };
    }
    const params = message.params ?? {};
    if (message.method === 'initialize') this.clientName = nameOf(params.clientInfo);
    const meta = isRecord(params._meta) ? params._meta : {};
    const incoming = parseTraceparent(meta.traceparent);
    const traceId = incoming?.traceId ?? this.options.traceId;
    const spanId = this.spanId();
    const traceparent = formatTraceparent(traceId, spanId);
    const pending: Pending = { method: message.method, traceId, spanId, startedAt: this.now() };
    if (incoming !== undefined) pending.parentSpanId = incoming.spanId;
    const toolName =
      message.method === 'tools/call' && typeof params.name === 'string' ? params.name : undefined;
    if (toolName !== undefined) pending.toolName = toolName;
    this.pending.set(idKey(message.id), pending);
    const forward: JsonRpcMessage = {
      ...message,
      params: { ...params, _meta: { ...meta, traceparent } },
    };
    const content: Record<string, string> =
      toolName !== undefined
        ? { [ATTR.toolCallArguments]: safeJson(params.arguments ?? {}) }
        : { [ATTR.mcpRequestParams]: safeJson(stripMeta(params)) };
    const event = this.event(
      message.id,
      pending,
      'request',
      'mcp.request',
      `mcp ${label(pending)}`,
      {
        traceparent,
      },
    );
    this.attach(event, content);
    const events = [event];
    const decision = this.advise(message.id, pending, event);
    if (decision !== undefined) events.push(decision);
    return { forward, events };
  }

  // Advisory only: the request has already been forwarded whatever the effect (ARCHITECTURE §7).
  private advise(id: JsonRpcId, pending: Pending, request: ProxyEvent): ProxyEvent | undefined {
    if (this.options.policy === undefined || pending.toolName === undefined) return undefined;
    const decision = evaluate(request, this.options.policy);
    if (decision.ruleId === undefined) return undefined;
    const attrs: Attrs = {
      'policy.mode': 'advisory',
      'policy.effect': decision.effect,
      'policy.rule.id': decision.ruleId,
      'policy.explanation': decision.explanation,
      'policy.subject': request.sourceId,
      [ATTR.mcpMethodName]: pending.method,
      [ATTR.mcpSessionId]: this.options.sessionId,
      [ATTR.mcpRequestId]: String(id),
      [ATTR.toolName]: pending.toolName,
    };
    const event: ProxyEvent = {
      sourceId: `${this.options.sessionId}:${idKey(id)}:policy`,
      sourceTs: this.iso(),
      source: 'mcp-proxy',
      provenance: 'reported',
      runId: pending.traceId,
      spanId: pending.spanId,
      kind: 'policy.decision',
      actor: { type: 'system', id: 'debrief-mcp-proxy' },
      attrs,
      summary: clip(
        `policy advisory: ${decision.effect} (${decision.ruleId}) for ${label(pending)}`,
      ),
    };
    if (request.target !== undefined) event.target = request.target;
    if (pending.parentSpanId !== undefined) event.parentSpanId = pending.parentSpanId;
    return event;
  }

  private attach(event: ProxyEvent, content: Record<string, string>): void {
    if ((this.options.capture ?? 'on') === 'off') return;
    event.content = redactAll(content);
  }

  onServerMessage(message: JsonRpcMessage): Relay {
    if (!isResponse(message) || message.id === undefined || message.id === null)
      return { forward: message, events: [] };
    const key = idKey(message.id);
    const pending = this.pending.get(key);
    if (pending === undefined) return { forward: message, events: [] };
    this.pending.delete(key);
    if (pending.method === 'initialize')
      this.serverName = nameOf(isRecord(message.result) ? message.result.serverInfo : undefined);
    const latencyMs = Math.max(0, Math.round((this.now() - pending.startedAt) * 1000) / 1000);
    const failed =
      message.error !== undefined || (isRecord(message.result) && message.result.isError === true);
    const status = failed ? 'error' : 'ok';
    const attrs: Attrs = { 'mcp.latency_ms': latencyMs, 'mcp.status': status };
    if (message.error !== undefined) attrs['jsonrpc.error.code'] = message.error.code;
    const event = this.event(
      message.id,
      pending,
      'response',
      'mcp.response',
      `mcp ${label(pending)} → ${status} (${String(latencyMs)} ms)`,
      attrs,
    );
    const content: Record<string, string> =
      message.error !== undefined
        ? { [ATTR.mcpResponseError]: safeJson(message.error) }
        : pending.toolName !== undefined
          ? { [ATTR.toolCallResult]: safeJson(message.result) }
          : { [ATTR.mcpResponseResult]: safeJson(message.result) };
    this.attach(event, content);
    return { forward: message, events: [event] };
  }

  private event(
    id: JsonRpcId,
    pending: Pending,
    suffix: 'request' | 'response',
    kind: 'mcp.request' | 'mcp.response',
    summary: string,
    extra: Attrs,
  ): ProxyEvent {
    const attrs: Attrs = {
      [ATTR.mcpMethodName]: pending.method,
      [ATTR.mcpSessionId]: this.options.sessionId,
      [ATTR.mcpRequestId]: String(id),
      'mcp.transport': this.options.transport,
      ...extra,
    };
    if (pending.toolName !== undefined) attrs[ATTR.toolName] = pending.toolName;
    if (this.serverName !== undefined) attrs['mcp.server.name'] = this.serverName;
    const actorId = this.clientName ?? 'mcp-client';
    const event: ProxyEvent = {
      sourceId: `${this.options.sessionId}:${idKey(id)}:${suffix}`,
      sourceTs: this.iso(),
      source: 'mcp-proxy',
      provenance: 'reported',
      runId: pending.traceId,
      spanId: pending.spanId,
      kind,
      actor:
        this.clientName === undefined
          ? { type: 'agent', id: actorId }
          : { type: 'agent', id: actorId, name: this.clientName },
      attrs,
      summary: clip(redactSecrets(summary).text),
    };
    if (pending.parentSpanId !== undefined) event.parentSpanId = pending.parentSpanId;
    if (pending.toolName !== undefined) {
      const target: Target = { system: this.serverName ?? 'mcp', operation: pending.toolName };
      event.target = target;
    }
    return event;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function nameOf(info: unknown): string | undefined {
  return isRecord(info) && typeof info.name === 'string' && info.name !== ''
    ? info.name
    : undefined;
}

function stripMeta(params: Record<string, unknown>): Record<string, unknown> {
  const { _meta: _dropped, ...rest } = params;
  return rest;
}

const label = (pending: Pending): string =>
  pending.toolName === undefined ? pending.method : `${pending.method} ${pending.toolName}`;

function redactAll(content: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(content).map(([key, value]) => [key, redactSecrets(value).text]),
  );
}
