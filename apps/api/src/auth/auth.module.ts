import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { ApiKeyGuard } from './api-key.guard.js';
import { ApiKeysRepository } from './api-keys.repository.js';

@Module({
  providers: [ApiKeysRepository, { provide: APP_GUARD, useClass: ApiKeyGuard }],
  exports: [ApiKeysRepository],
})
export class AuthModule {}
