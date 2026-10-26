import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';

import type { AuthenticatedRequest } from '../auth/api-key.guard.js';
import { RateBucketOf } from '../rate-limit/rate-bucket.decorator.js';
import { ClaimsService } from './claims.service.js';

// ARCHITECTURE §18.3: extraction runs on request (P-65.1 runs it when a session settles), cached by transcript.
@Controller('v1/runs/:id')
@RateBucketOf('expensive')
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Post('claims')
  @HttpCode(200)
  extract(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.claims.extract(request.auth.tenantId, id);
  }
}
