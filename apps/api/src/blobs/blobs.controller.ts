import {
  BadRequestException,
  Controller,
  Get,
  GoneException,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import type { AuthenticatedRequest } from '../auth/api-key.guard.js';
import { TenantKeyDestroyedError } from '../tenants/tenant-keys.service.js';
import { BlobCorruptError, BlobsService } from './blobs.service.js';

const SHA256 = /^[0-9a-f]{64}$/;

// Content-addressed and already redacted at capture (§6.4): safe to cache forever, gone forever once the tenant key is destroyed.
@Controller('v1/blobs')
export class BlobsController {
  constructor(private readonly blobs: BlobsService) {}

  @Get(':sha256')
  async get(
    @Req() request: AuthenticatedRequest,
    @Param('sha256') sha256: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    if (!SHA256.test(sha256)) throw new BadRequestException('sha256 is 64 lowercase hex chars');
    let found;
    try {
      found = await this.blobs.get(request.auth.tenantId, sha256);
    } catch (error) {
      if (error instanceof TenantKeyDestroyedError) {
        throw new GoneException('the tenant data key was destroyed; this payload is unrecoverable');
      }
      if (error instanceof BlobCorruptError) {
        throw new InternalServerErrorException('blob failed its integrity check');
      }
      throw error;
    }
    if (found === undefined) throw new NotFoundException('blob not found');
    void reply.header('content-type', found.blob.mime);
    void reply.header('cache-control', 'private, max-age=31536000, immutable');
    void reply.header('x-blob-sha256', sha256);
    return Buffer.from(found.body);
  }
}
