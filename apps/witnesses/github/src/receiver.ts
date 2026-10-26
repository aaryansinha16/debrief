import { createServer, type Server } from 'node:http';

import {
  type GithubWireEvent,
  isWebhookEvent,
  type Job,
  mapWebhook,
  WitnessPayloadError,
  webhookSchemas,
} from '@debrief/witness-github';

import type { GithubClient } from './github-api.js';
import { readRunTests } from './reports.js';
import type { Sink } from './sink.js';
import { verifySignature } from './signature.js';

export const MAX_BODY_BYTES = 5 * 1024 * 1024;

export interface ReceiverOptions {
  secret: string;
  sink: Sink;
  // With a read-only client the receiver fetches a finished run's jobs, so counts match the poller.
  github?: GithubClient;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface Reply {
  status: number;
  body: string;
}

const reply = (status: number, body: string): Reply => ({ status, body });

export async function handleDelivery(
  options: ReceiverOptions,
  delivery: { event: string | undefined; signature: string | undefined; body: Buffer },
): Promise<Reply> {
  if (!verifySignature(options.secret, delivery.body, delivery.signature)) {
    return reply(401, 'bad signature');
  }
  const name = delivery.event ?? '';
  if (name === 'ping') return reply(200, 'pong');
  if (!isWebhookEvent(name)) return reply(202, 'ignored');
  let payload: unknown;
  try {
    payload = JSON.parse(delivery.body.toString('utf8'));
  } catch {
    return reply(400, 'body is not JSON');
  }
  try {
    let jobs: Job[] | undefined;
    let tests: GithubWireEvent[] = [];
    if (name === 'workflow_run' && options.github !== undefined) {
      const run = webhookSchemas.workflow_run.safeParse(payload);
      if (run.success && run.data.action === 'completed') {
        jobs = await options.github.jobs(
          run.data.repository.full_name,
          run.data.workflow_run.id,
          run.data.workflow_run.run_attempt,
        );
        const log = options.log ?? ((): void => undefined);
        tests = (
          await readRunTests(
            options.github,
            run.data.repository.full_name,
            run.data.workflow_run,
            log,
          )
        ).events;
      }
    }
    const events = [
      ...mapWebhook(name, payload, {
        receivedAt: (options.now?.() ?? new Date()).toISOString(),
        ...(jobs === undefined ? {} : { jobs }),
      }),
      ...tests,
    ];
    if (events.length === 0) return reply(202, 'ignored');
    const result = await options.sink.post(events);
    options.log?.(
      `${name}: ${String(result.accepted)} stored, ${String(result.duplicates)} duplicate`,
    );
    return reply(200, JSON.stringify(result));
  } catch (error) {
    if (error instanceof WitnessPayloadError) return reply(400, error.message);
    options.log?.(`${name}: ${String(error)}`);
    return reply(502, 'could not record the delivery');
  }
}

export async function readBody(source: AsyncIterable<unknown>): Promise<Buffer | Reply> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of source) {
      const buffer = chunk as Buffer;
      size += buffer.length;
      if (size > MAX_BODY_BYTES) return reply(413, 'payload too large');
      chunks.push(buffer);
    }
  } catch {
    return reply(400, 'request body could not be read');
  }
  return Buffer.concat(chunks);
}

export function createReceiverServer(options: ReceiverOptions, path = '/webhook'): Server {
  return createServer((request, response) => {
    const finish = (r: Reply): void => {
      response.writeHead(r.status, { 'content-type': 'text/plain' }).end(r.body);
    };
    if (request.method !== 'POST' || request.url !== path) {
      finish(reply(404, 'not found'));
      return;
    }
    void readBody(request)
      .then(async (body) => {
        if (!Buffer.isBuffer(body)) return body;
        const header = (name: string): string | undefined => {
          const value = request.headers[name];
          return typeof value === 'string' ? value : undefined;
        };
        return handleDelivery(options, {
          event: header('x-github-event'),
          signature: header('x-hub-signature-256'),
          body,
        });
      })
      .then(finish)
      .catch(() => {
        finish(reply(500, 'internal error'));
      });
  });
}
