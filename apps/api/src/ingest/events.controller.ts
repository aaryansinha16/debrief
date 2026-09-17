import type { EventInput } from '@debrief/schema';
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  PayloadTooLargeException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import type { AuthenticatedRequest } from '../auth/api-key.guard.js';
import { CheckpointerService } from '../checkpoints/checkpointer.service.js';
import { type AppendItem, EventsRepository } from '../events/events.repository.js';
import { ulid } from '../ids/ulid.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { MAX_BATCH_BYTES, MAX_BATCH_EVENTS, nativeBatchSchema } from './native-events.js';

export interface IngestResponse {
  accepted: number;
  duplicates: number;
  events: { id: string; seq: number }[];
}

@Controller('v1')
@UseGuards(RateLimitGuard)
export class EventsController {
  constructor(
    private readonly events: EventsRepository,
    private readonly checkpointer: CheckpointerService,
  ) {}

  @Post('events')
  @HttpCode(200)
  async ingest(
    @Req() request: AuthenticatedRequest,
    @Headers('content-length') contentLength: string | undefined,
    @Body() body: unknown,
  ): Promise<IngestResponse> {
    const declared = Number(contentLength ?? Buffer.byteLength(JSON.stringify(body ?? null)));
    if (declared > MAX_BATCH_BYTES) {
      throw new PayloadTooLargeException(`batch exceeds ${String(MAX_BATCH_BYTES)} bytes`);
    }
    if (
      Array.isArray((body as { events?: unknown } | null)?.events) &&
      (body as { events: unknown[] }).events.length > MAX_BATCH_EVENTS
    ) {
      throw new PayloadTooLargeException(`batch exceeds ${String(MAX_BATCH_EVENTS)} events`);
    }
    const parsed = nativeBatchSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new BadRequestException(
        `${issue?.path.join('.') ?? 'body'}: ${issue?.message ?? 'invalid'}`,
      );
    }
    const { tenantId } = request.auth;
    const ts = new Date().toISOString();
    const items: AppendItem[] = parsed.data.events.map(({ sourceId, ...event }) => {
      const input: EventInput = { ...event, id: ulid(), ts, tenantId };
      return sourceId === undefined ? { input } : { input, sourceId };
    });
    const result = await this.events.append(tenantId, items);
    const last = result.events[result.events.length - 1];
    if (last !== undefined) this.checkpointer.observe(tenantId, last.seq);
    return {
      accepted: result.events.length,
      duplicates: result.duplicates,
      events: result.events.map(({ id, seq }) => ({ id, seq })),
    };
  }
}
