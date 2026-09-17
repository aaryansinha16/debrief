import { Global, Module } from '@nestjs/common';

import { CONFIG, type Config } from '../config/config.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { RateLimiter } from './rate-limiter.js';

@Global()
@Module({
  providers: [
    {
      provide: RateLimiter,
      useFactory: (config: Config) => new RateLimiter(config.RATE_LIMIT_PER_MINUTE),
      inject: [CONFIG],
    },
    RateLimitGuard,
  ],
  exports: [RateLimiter, RateLimitGuard],
})
export class RateLimitModule {}
