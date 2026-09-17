import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import type { AuthenticatedRequest } from '../auth/api-key.guard.js';
import { RateLimiter } from './rate-limiter.js';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly limiter: RateLimiter) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const decision = this.limiter.check(request.auth.keyId);
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
