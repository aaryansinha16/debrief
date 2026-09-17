import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module.js';
import { MeController } from './auth/me.controller.js';
import { ConfigModule } from './config/config.module.js';
import { DbModule } from './db/db.module.js';
import { EventsModule } from './events/events.module.js';
import { HealthController } from './health/health.controller.js';
import { LoggingModule } from './logging/logging.module.js';
import { OtlpModule } from './otlp/otlp.module.js';

@Module({
  imports: [ConfigModule, LoggingModule, DbModule, AuthModule, EventsModule, OtlpModule],
  controllers: [HealthController, MeController],
})
export class AppModule {}
