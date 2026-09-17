import type { Event, Run } from '@debrief/schema';
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';

import type { AuthenticatedRequest } from '../auth/api-key.guard.js';
import { EventsRepository } from '../events/events.repository.js';
import { type RunPage, RunsRepository, decodeRunCursor } from './runs.repository.js';
import { RunsService } from './runs.service.js';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
  since: z.iso.datetime().optional(),
});

const eventsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(1000).default(200),
    cursor: z.string().min(1).optional(),
    from: z.coerce.number().int().min(0).optional(),
    to: z.coerce.number().int().min(0).optional(),
  })
  .refine(
    (query) => query.from === undefined || query.to === undefined || query.from <= query.to,
    'from must not exceed to',
  );

export interface EventsPage {
  events: Event[];
  nextCursor?: string;
}

const encodeSeqCursor = (seq: number): string =>
  Buffer.from(String(seq), 'utf8').toString('base64url');
const decodeSeqCursor = (cursor: string): number | undefined => {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^\d{1,16}$/.test(text)) return undefined;
  const seq = Number(text);
  return Number.isSafeInteger(seq) ? seq : undefined;
};

@Controller('v1/runs')
export class RunsController {
  constructor(
    private readonly runs: RunsService,
    private readonly runsRepository: RunsRepository,
    private readonly events: EventsRepository,
  ) {}

  @Get()
  async list(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
  ): Promise<RunPage> {
    const parsed = listQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException('limit 1..200, cursor from a previous page, since as RFC 3339');
    }
    const cursor =
      parsed.data.cursor === undefined ? undefined : decodeRunCursor(parsed.data.cursor);
    if (parsed.data.cursor !== undefined && cursor === undefined) {
      throw new BadRequestException('invalid cursor');
    }
    return this.runsRepository.list(
      request.auth.tenantId,
      parsed.data.limit,
      cursor,
      parsed.data.since,
    );
  }

  @Get(':id')
  async get(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<Run> {
    const run = await this.runs.get(request.auth.tenantId, id);
    if (run === undefined) throw new NotFoundException('run not found');
    return run;
  }

  // Cursor = last seq served; seq is append-only and monotonic, so pages stay stable under concurrent ingest.
  @Get(':id/events')
  async listEvents(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ): Promise<EventsPage> {
    const parsed = eventsQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException('limit 1..1000, cursor from a previous page, from <= to');
    }
    const after =
      parsed.data.cursor === undefined ? undefined : decodeSeqCursor(parsed.data.cursor);
    if (parsed.data.cursor !== undefined && after === undefined) {
      throw new BadRequestException('invalid cursor');
    }
    const fromSeq = Math.max(parsed.data.from ?? 0, after === undefined ? 0 : after + 1);
    const rows = await this.events.listByRun(
      request.auth.tenantId,
      id,
      fromSeq,
      parsed.data.to,
      parsed.data.limit + 1,
    );
    const page = rows.slice(0, parsed.data.limit);
    if (page.length === 0 && after === undefined && parsed.data.from === undefined) {
      const run = await this.runs.get(request.auth.tenantId, id);
      if (run === undefined) throw new NotFoundException('run not found');
    }
    const last = page[page.length - 1];
    return rows.length > parsed.data.limit && last !== undefined
      ? { events: page, nextCursor: encodeSeqCursor(last.seq) }
      : { events: page };
  }
}
