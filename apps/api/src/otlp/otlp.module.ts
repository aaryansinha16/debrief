import { Module } from '@nestjs/common';

import { EventsModule } from '../events/events.module.js';
import { OtlpService } from './otlp.service.js';
import { TracesController } from './traces.controller.js';

@Module({
  imports: [EventsModule],
  controllers: [TracesController],
  providers: [OtlpService],
  exports: [OtlpService],
})
export class OtlpModule {}
