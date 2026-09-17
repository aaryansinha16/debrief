import { randomUUID } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Policy } from '@debrief/policy';
import type { CaptureMode } from '@debrief/schema';

import type { EventsEmitter } from './emitter.js';
import { type JsonRpcMessage, jsonRpcMessageSchema } from './jsonrpc.js';
import { SessionRecorder } from './recorder.js';
import { randomTraceId } from './traceparent.js';

export interface HttpProxyOptions {
  upstream: string;
  listen?: number;
  emitter: EventsEmitter;
  capture?: CaptureMode;
  policy?: Policy;
  fetch?: typeof fetch;
  log?: (message: string) => void;
}

export interface HttpProxyHandle {
  server: Server;
  url: string;
  sessions: Map<string, SessionRecorder>;
  close(): Promise<void>;
}

const FORWARD_HEADERS = [
  'content-type',
  'accept',
  'authorization',
  'mcp-session-id',
  'mcp-protocol-version',
  'last-event-id',
];
const RETURN_HEADERS = [
  'content-type',
  'mcp-session-id',
  'mcp-protocol-version',
  'cache-control',
  'www-authenticate',
];
const PENDING_SESSION = 'pending';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.on('end', () => {
      resolve(body);
    });
    req.on('error', reject);
  });
}

function parseMessages(body: string): JsonRpcMessage[] | undefined {
  try {
    const raw: unknown = JSON.parse(body);
    const list = Array.isArray(raw) ? raw : [raw];
    const parsed = list.map((item) => jsonRpcMessageSchema.safeParse(item));
    const messages: JsonRpcMessage[] = [];
    for (const item of parsed) {
      if (!item.success) return undefined;
      messages.push(item.data);
    }
    return messages;
  } catch {
    return undefined;
  }
}

// Server→client SSE frames are relayed byte-for-byte; the data lines are parsed on the side for recording.
class SseTap {
  private pending = '';

  constructor(private readonly onMessage: (message: JsonRpcMessage) => void) {}

  push(chunk: string): void {
    this.pending += chunk;
    const frames = this.pending.split(/\r?\n\r?\n/);
    this.pending = frames.pop() ?? '';
    for (const frame of frames) this.frame(frame);
  }

  flush(): void {
    if (this.pending.trim() !== '') this.frame(this.pending);
    this.pending = '';
  }

  private frame(frame: string): void {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (data === '') return;
    for (const message of parseMessages(data) ?? []) this.onMessage(message);
  }
}

export function startHttpProxy(options: HttpProxyOptions): Promise<HttpProxyHandle> {
  const sessions = new Map<string, SessionRecorder>();
  const doFetch = options.fetch ?? fetch;
  const upstream = new URL(options.upstream);

  const recorderFor = (sessionId: string | undefined): [string, SessionRecorder] => {
    const key = sessionId ?? PENDING_SESSION;
    const existing = sessions.get(key);
    if (existing !== undefined) return [key, existing];
    const recorder = new SessionRecorder({
      sessionId: randomUUID(),
      traceId: randomTraceId(),
      transport: 'http',
      capture: options.capture,
      policy: options.policy,
    });
    sessions.set(key, recorder);
    return [key, recorder];
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const headers = new Headers();
    for (const name of FORWARD_HEADERS) {
      const value = req.headers[name];
      if (typeof value === 'string') headers.set(name, value);
    }
    const sessionHeader = req.headers['mcp-session-id'];
    const [key, recorder] = recorderFor(
      typeof sessionHeader === 'string' ? sessionHeader : undefined,
    );
    let body: string | undefined;
    if (req.method === 'POST') {
      const raw = await readBody(req);
      const messages = parseMessages(raw);
      if (messages === undefined) {
        body = raw;
      } else {
        const relayed = messages.map((message) => recorder.onClientMessage(message));
        await options.emitter.push(relayed.flatMap((relay) => relay.events));
        const forwards = relayed.map((relay) => relay.forward);
        body = JSON.stringify(Array.isArray(JSON.parse(raw)) ? forwards : forwards[0]);
      }
    }
    const target = new URL(req.url ?? '/', upstream);
    let response: Response;
    try {
      response = await doFetch(target, {
        method: req.method,
        headers,
        body,
        signal: AbortSignal.timeout(300_000),
      });
    } catch (error) {
      options.log?.(`debrief-mcp-proxy: upstream ${target.href} failed: ${String(error)}`);
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: 'upstream unavailable' },
        }),
      );
      return;
    }
    const newSession = response.headers.get('mcp-session-id');
    if (newSession !== null && key === PENDING_SESSION) {
      sessions.delete(PENDING_SESSION);
      sessions.set(newSession, recorder);
    }
    const outHeaders: Record<string, string> = {};
    for (const name of RETURN_HEADERS) {
      const value = response.headers.get(name);
      if (value !== null) outHeaders[name] = value;
    }
    res.writeHead(response.status, outHeaders);
    if (response.body === null) {
      res.end();
      return;
    }
    const contentType = response.headers.get('content-type') ?? '';
    const decoder = new TextDecoder();
    if (contentType.startsWith('text/event-stream')) {
      const tap = new SseTap((message) => {
        void options.emitter.push(recorder.onServerMessage(message).events);
      });
      for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
        res.write(chunk);
        tap.push(decoder.decode(chunk, { stream: true }));
      }
      tap.flush();
      res.end();
      return;
    }
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    const text = Buffer.concat(chunks);
    if (contentType.startsWith('application/json')) {
      for (const message of parseMessages(text.toString('utf8')) ?? []) {
        await options.emitter.push(recorder.onServerMessage(message).events);
      }
    }
    res.end(text);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      options.log?.(`debrief-mcp-proxy: request failed: ${String(error)}`);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(options.listen ?? 0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        server,
        url: `http://127.0.0.1:${String(port)}${upstream.pathname}`,
        sessions,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}
