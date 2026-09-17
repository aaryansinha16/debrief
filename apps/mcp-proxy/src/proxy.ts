import { type ChildProcess, spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';

import type { Policy } from '@debrief/policy';
import type { CaptureMode } from '@debrief/schema';

import { EventsEmitter } from './emitter.js';
import { LineBuffer, parseMessage } from './jsonrpc.js';
import { SessionRecorder } from './recorder.js';
import { randomTraceId } from './traceparent.js';

export interface ProxyOptions {
  command: string;
  args: readonly string[];
  emitter: EventsEmitter;
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  sessionId?: string;
  traceId?: string;
  env?: NodeJS.ProcessEnv;
  capture?: CaptureMode;
  policy?: Policy;
}

export interface ProxyHandle {
  child: ChildProcess;
  childStdin: Writable;
  childStdout: Readable;
  recorder: SessionRecorder;
  sessionId: string;
  exited: Promise<number>;
}

export function startProxy(options: ProxyOptions): ProxyHandle {
  const sessionId = options.sessionId ?? randomUUID();
  const recorder = new SessionRecorder({
    sessionId,
    traceId: options.traceId ?? randomTraceId(),
    transport: 'stdio',
    capture: options.capture,
    policy: options.policy,
  });
  const child = spawn(options.command, options.args, {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: options.env ?? process.env,
  });
  const childStdin = child.stdin;
  const childStdout = child.stdout;
  const toChild = new LineBuffer();
  const fromChild = new LineBuffer();

  const lanes = { client: Promise.resolve(), server: Promise.resolve() };
  const relay = (line: string, direction: 'client' | 'server'): void => {
    lanes[direction] = lanes[direction].then(async () => {
      const message = parseMessage(line);
      const sink = direction === 'client' ? childStdin : options.stdout;
      if (message === undefined) {
        sink.write(`${line}\n`);
        return;
      }
      const { forward, events } =
        direction === 'client'
          ? recorder.onClientMessage(message)
          : recorder.onServerMessage(message);
      await options.emitter.push(events);
      sink.write(`${JSON.stringify(forward)}\n`);
    });
  };

  options.stdin.setEncoding('utf8');
  options.stdin.on('data', (chunk: string) => {
    for (const line of toChild.push(chunk)) relay(line, 'client');
  });
  options.stdin.on('end', () => {
    for (const line of toChild.flush()) relay(line, 'client');
    void lanes.client.then(() => {
      childStdin.end();
    });
  });
  childStdout.setEncoding('utf8');
  childStdout.on('data', (chunk: string) => {
    for (const line of fromChild.push(chunk)) relay(line, 'server');
  });

  const exited = new Promise<number>((resolve) => {
    child.on('error', (error) => {
      options.stderr.write(
        `debrief-mcp-proxy: failed to start ${options.command}: ${error.message}\n`,
      );
      resolve(1);
    });
    child.on('close', (code, signal) => {
      for (const line of fromChild.flush()) relay(line, 'server');
      void lanes.server
        .then(() => options.emitter.drain())
        .then(() => {
          resolve(code ?? (signal === null ? 1 : 128));
        });
    });
  });

  return { child, childStdin, childStdout, recorder, sessionId, exited };
}
