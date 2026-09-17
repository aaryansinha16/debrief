import 'reflect-metadata';

import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { ApiKeyGuard, type AuthenticatedRequest } from './api-key.guard.js';
import { generateApiKey } from './api-keys.js';
import type { ApiKeysRepository, ResolvedKey } from './api-keys.repository.js';
import { Public } from './public.decorator.js';

const known = generateApiKey();
const resolved: ResolvedKey = { keyId: 'key-1', tenantId: 'tenant-a', captureMode: 'summary' };

const repository = {
  resolve: (keyHash: string) => Promise.resolve(keyHash === known.keyHash ? resolved : undefined),
} as ApiKeysRepository;

const guard = new ApiKeyGuard(new Reflector(), repository);

function context(
  authorization: string | undefined,
  handler: object = () => undefined,
): {
  ctx: ExecutionContext;
  request: Partial<AuthenticatedRequest>;
} {
  const request: Partial<AuthenticatedRequest> = { headers: { authorization } };
  const ctx = {
    getHandler: () => handler,
    getClass: () => Object,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request };
}

describe('ApiKeyGuard', () => {
  it('accepts a known key and attaches the resolved tenant', async () => {
    const { ctx, request } = context(`Bearer ${known.key}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.auth).toEqual(resolved);
  });

  it.each([
    ['no header', undefined],
    ['wrong scheme', `Basic ${known.key}`],
    ['wrong prefix', 'Bearer abc'],
    ['unknown key', `Bearer ${generateApiKey().key}`],
    ['known key with a flipped char', `Bearer ${known.key.slice(0, -1)}!`],
  ])('rejects %s with 401', async (_label, header) => {
    const { ctx, request } = context(header);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(request.auth).toBeUndefined();
  });

  it('skips public handlers and classes', async () => {
    const handler = (): undefined => undefined;
    Public()(handler);
    await expect(guard.canActivate(context(undefined, handler).ctx)).resolves.toBe(true);
    @Public()
    class PublicRoute {}
    const ctx = {
      getHandler: () => () => undefined,
      getClass: () => PublicRoute,
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
