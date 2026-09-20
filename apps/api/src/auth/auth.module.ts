import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { ApiKeyGuard } from './api-key.guard.js';
import { ApiKeysRepository } from './api-keys.repository.js';
import { KeysController } from './keys.controller.js';

// Global guards run in registration order: the key is resolved first, then its bucket is charged.
@Module({
  providers: [
    ApiKeysRepository,
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  controllers: [KeysController],
  exports: [ApiKeysRepository],
})
export class AuthModule {}
