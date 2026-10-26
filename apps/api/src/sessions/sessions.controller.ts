import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';

import type { AuthenticatedRequest } from '../auth/api-key.guard.js';
import { RateBucketOf } from '../rate-limit/rate-bucket.decorator.js';
import { SessionsRepository } from './sessions.repository.js';
import { SessionsService } from './sessions.service.js';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

@Controller('v1/sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly repository: SessionsRepository,
  ) {}

  @Get()
  async list(@Req() request: AuthenticatedRequest, @Query() query: Record<string, string>) {
    const parsed = listQuerySchema.safeParse(query);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new BadRequestException(
        `${issue?.path.join('.') ?? 'query'}: ${issue?.message ?? 'invalid'}`,
      );
    }
    return { sessions: await this.repository.list(request.auth.tenantId, parsed.data.limit) };
  }

  // GET reads what the record holds; POST runs the check and appends what it lacks (§18.4).
  @Get(':id/check')
  read(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.sessions.read(request.auth.tenantId, id);
  }

  @Post(':id/check')
  @HttpCode(200)
  @RateBucketOf('expensive')
  check(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.sessions.check(request.auth.tenantId, id);
  }
}
