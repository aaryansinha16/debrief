import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module.js';
import { CheckpointsModule } from './checkpoints/checkpoints.module.js';
import { MeController } from './auth/me.controller.js';
import { ConfigModule } from './config/config.module.js';
import { DbModule } from './db/db.module.js';
import { EventsModule } from './events/events.module.js';
import { HealthController } from './health/health.controller.js';
import { IngestModule } from './ingest/ingest.module.js';
import { LoggingModule } from './logging/logging.module.js';
import { OtlpModule } from './otlp/otlp.module.js';
import { RateLimitModule } from './rate-limit/rate-limit.module.js';
import { SigningModule } from './signing/signing.module.js';
import { StorageModule } from './storage/storage.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    DbModule,
    AuthModule,
    EventsModule,
    RateLimitModule,
    SigningModule,
    StorageModule,
    CheckpointsModule,
    OtlpModule,
    IngestModule,
  ],
  controllers: [HealthController, MeController],
})
export class AppModule {}
