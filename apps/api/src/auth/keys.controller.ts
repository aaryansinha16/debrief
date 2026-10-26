import { witnessTrustSchema } from '@debrief/schema';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { z } from 'zod';

import { RateBucketOf } from '../rate-limit/rate-bucket.decorator.js';
import type { AuthenticatedRequest } from './api-key.guard.js';
import { type ApiKeySummary, ApiKeysRepository, type IssuedApiKey } from './api-keys.repository.js';
import { exceedsTrust } from './trust.js';

const createSchema = z
  .object({ name: z.string().trim().min(1).max(64), trust: witnessTrustSchema.default('local') })
  .strict();

const aboveTrust = (verb: string): ForbiddenException =>
  new ForbiddenException(`a key cannot ${verb} a key above its own trust (D-084)`);

// ARCHITECTURE §14: keys are managed with a key; rotation revokes the old one in the same transaction.
@Controller('v1/keys')
@RateBucketOf('expensive')
export class KeysController {
  constructor(private readonly keys: ApiKeysRepository) {}

  @Get()
  async list(
    @Req() request: AuthenticatedRequest,
  ): Promise<{ keys: (ApiKeySummary & { current: boolean })[] }> {
    const keys = await this.keys.list(request.auth.tenantId);
    return { keys: keys.map((key) => ({ ...key, current: key.id === request.auth.keyId })) };
  }

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown): Promise<IssuedApiKey> {
    const parsed = createSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(
        'body is { name: string (1–64 chars), trust?: local | third-party }',
      );
    }
    if (exceedsTrust(parsed.data.trust, request.auth.trust)) throw aboveTrust('issue');
    return this.keys.create(request.auth.tenantId, parsed.data.name, parsed.data.trust);
  }

  @Post(':id/rotate')
  async rotate(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<IssuedApiKey & { rotatedFrom: string }> {
    const issued = await this.keys.rotate(request.auth.tenantId, id, request.auth.trust);
    if (issued === 'not-found') throw new NotFoundException('no active key with that id');
    if (issued === 'above-trust') throw aboveTrust('rotate');
    return { ...issued, rotatedFrom: id };
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    const outcome = await this.keys.revoke(request.auth.tenantId, id, request.auth.trust);
    if (outcome === 'not-found') throw new NotFoundException('no active key with that id');
    if (outcome === 'above-trust') throw aboveTrust('revoke');
    if (outcome === 'last-active') {
      throw new ConflictException('the last active key cannot be revoked; rotate it instead');
    }
  }
}
