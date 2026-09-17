import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { z } from 'zod';

import type { AuthenticatedRequest } from '../auth/api-key.guard.js';
import { type EvidenceJob, EvidenceService } from './evidence.service.js';

const bodySchema = z
  .object({
    includeContent: z.boolean().default(false),
    policyId: z.string().min(1).default('prod-guard'),
  })
  .strict();

// ARCHITECTURE §13: POST /v1/runs/:id/evidence → GET /v1/evidence/:jobId; the bundle itself is one more GET for verifiers without S3 access.
@Controller('v1')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Post('runs/:id/evidence')
  @HttpCode(202)
  create(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<EvidenceJob> {
    const parsed = bodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException('body is { includeContent?: boolean, policyId?: string }');
    }
    return this.evidence.create(request.auth.tenantId, id, parsed.data);
  }

  @Get('evidence/:jobId')
  get(@Req() request: AuthenticatedRequest, @Param('jobId') jobId: string): Promise<EvidenceJob> {
    return this.evidence.get(request.auth.tenantId, jobId);
  }

  @Get('evidence/:jobId/bundle.zip')
  @Header('content-type', 'application/zip')
  @Header('cache-control', 'private, no-store')
  async bundle(
    @Req() request: AuthenticatedRequest,
    @Param('jobId') jobId: string,
  ): Promise<Buffer> {
    return Buffer.from(await this.evidence.bundle(request.auth.tenantId, jobId));
  }
}
