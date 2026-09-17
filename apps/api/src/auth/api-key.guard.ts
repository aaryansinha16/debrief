import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { ApiKeysRepository, type ResolvedKey } from './api-keys.repository.js';
import { hashApiKey, parseBearer } from './api-keys.js';
import { IS_PUBLIC } from './public.decorator.js';

export type AuthenticatedRequest = FastifyRequest & { auth: ResolvedKey };

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly keys: ApiKeysRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const key = parseBearer(request.headers.authorization);
    if (key === undefined) throw new UnauthorizedException('missing or malformed bearer key');
    const resolved = await this.keys.resolve(hashApiKey(key));
    if (resolved === undefined) throw new UnauthorizedException('unknown or revoked key');
    (request as AuthenticatedRequest).auth = resolved;
    return true;
  }
}
