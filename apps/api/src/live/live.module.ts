import { Module } from '@nestjs/common';

import { EventsModule } from '../events/events.module.js';
import { LiveController } from './live.controller.js';
import { LiveService } from './live.service.js';

@Module({
  imports: [EventsModule],
  controllers: [LiveController],
  providers: [LiveService],
  exports: [LiveService],
})
export class LiveModule {}
