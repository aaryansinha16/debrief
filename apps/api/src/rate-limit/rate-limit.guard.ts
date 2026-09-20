import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply } from 'fastify';

import type { AuthenticatedRequest } from '../auth/api-key.guard.js';
import { RATE_BUCKET } from './rate-bucket.decorator.js';
import { type RateBucket, RateLimiter } from './rate-limiter.js';

// Runs after ApiKeyGuard (registered in that order in AuthModule); public routes carry no key and are not limited.
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Partial<AuthenticatedRequest>>();
    if (request.auth === undefined) return true;
    const bucket =
      this.reflector.getAllAndOverride<RateBucket | undefined>(RATE_BUCKET, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'read';
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const decision = this.limiter.check(request.auth.keyId, bucket);
    void reply.header('x-ratelimit-limit', String(decision.limit));
    void reply.header('x-ratelimit-remaining', String(decision.remaining));
    if (decision.allowed) return true;
    void reply.header('retry-after', String(decision.retryAfterSeconds));
    throw new HttpException(
      { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'rate limit exceeded' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
