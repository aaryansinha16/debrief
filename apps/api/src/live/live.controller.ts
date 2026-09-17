import type { Event } from '@debrief/schema';
import { BadRequestException, Controller, Get, Inject, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';

import type { AuthenticatedRequest } from '../auth/api-key.guard.js';
import { CONFIG, type Config } from '../config/config.js';
import { LiveService, type Subscriber } from './live.service.js';

const querySchema = z.object({
  since: z.coerce.number().int().min(-1).optional(),
  run: z.string().min(1).optional(),
});

const frame = (name: string, id: number | undefined, data: string): string =>
  `event: ${name}\n${id === undefined ? '' : `id: ${String(id)}\n`}data: ${data}\n\n`;

// SSE over the tenant's event stream: `id` is the seq, so Last-Event-ID or ?since= resumes without gaps or duplicates.
@Controller('v1')
export class LiveController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly live: LiveService,
  ) {}

  // Without a cursor the stream starts at the current head: a live feed, not a replay.
  @Get('live')
  async stream(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException('since must be an integer seq, run a run id');
    const header = request.headers['last-event-id'];
    const lastEventId =
      typeof header === 'string' && /^\d+$/.test(header) ? Number(header) : undefined;
    const since =
      parsed.data.since ?? lastEventId ?? (await this.live.headSeq(request.auth.tenantId));
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    raw.write(`retry: 1000\n\n`);
    const seenRuns = new Set<string>();
    const subscriber: Subscriber = {
      tenantId: request.auth.tenantId,
      lastSeq: since,
      close: () => {
        if (!raw.destroyed) raw.end();
      },
      send: (event: Event) => {
        if (raw.destroyed) return false;
        if (!seenRuns.has(event.runId)) {
          seenRuns.add(event.runId);
          raw.write(
            frame('run', undefined, JSON.stringify({ runId: event.runId, firstSeq: event.seq })),
          );
        }
        raw.write(frame('event', event.seq, JSON.stringify(event)));
        return true;
      },
    };
    if (parsed.data.run !== undefined) subscriber.runId = parsed.data.run;
    const unsubscribe = this.live.subscribe(subscriber);
    const heartbeat = setInterval(() => {
      if (!raw.destroyed) raw.write(`: keepalive ${new Date().toISOString()}\n\n`);
    }, this.config.LIVE_HEARTBEAT_MS);
    const close = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
      if (!raw.destroyed) raw.end();
    };
    request.raw.on('close', close);
    raw.on('close', close);
  }
}
