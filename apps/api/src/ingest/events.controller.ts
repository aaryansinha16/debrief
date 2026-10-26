import { WITNESS_TRUST_ATTR, witnessTrustSchema } from '@debrief/schema';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  PayloadTooLargeException,
  Post,
  Req,
} from '@nestjs/common';

import type { AuthenticatedRequest } from '../auth/api-key.guard.js';
import { exceedsTrust } from '../auth/trust.js';
import { CaptureService } from '../capture/capture.service.js';
import { CheckpointerService } from '../checkpoints/checkpointer.service.js';
import { type AppendItem, EventsRepository } from '../events/events.repository.js';
import { ulid } from '../ids/ulid.js';
import { RateBucketOf } from '../rate-limit/rate-bucket.decorator.js';
import { RunsService } from '../runs/runs.service.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { MAX_BATCH_BYTES, MAX_BATCH_EVENTS, nativeBatchSchema } from './native-events.js';

export interface IngestResponse {
  accepted: number;
  duplicates: number;
  events: { id: string; seq: number }[];
}

@Controller('v1')
@RateBucketOf('ingest')
export class EventsController {
  constructor(
    private readonly events: EventsRepository,
    private readonly checkpointer: CheckpointerService,
    private readonly capture: CaptureService,
    private readonly runs: RunsService,
    private readonly sessions: SessionsService,
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
    const { tenantId, captureMode, trust } = request.auth;
    const above = parsed.data.events.findIndex((event) => {
      const asserted = witnessTrustSchema.safeParse(event.attrs[WITNESS_TRUST_ATTR]);
      return asserted.success && exceedsTrust(asserted.data, trust);
    });
    if (above >= 0) {
      throw new ForbiddenException(
        `events.${String(above)}.attrs.${WITNESS_TRUST_ATTR}: this key asserts ${trust} trust at most (D-084)`,
      );
    }
    const ts = new Date().toISOString();
    const candidates = parsed.data.events.map(({ sourceId, content, ...event }) => ({
      sourceId,
      input: { ...event, id: ulid(), ts, tenantId },
      content,
    }));
    const inputs = await this.capture.apply(tenantId, captureMode, candidates);
    const items: AppendItem[] = inputs.map((input, i) => {
      const sourceId = candidates[i]?.sourceId;
      return sourceId === undefined ? { input } : { input, sourceId };
    });
    const result = await this.events.append(tenantId, items, trust);
    const last = result.events[result.events.length - 1];
    if (last !== undefined) this.checkpointer.observe(tenantId, last.seq);
    this.runs.observe(tenantId, result.events);
    this.sessions.observe(tenantId, result.events);
    return {
      accepted: result.events.length,
      duplicates: result.duplicates,
      events: result.events.map(({ id, seq }) => ({ id, seq })),
    };
  }
}
