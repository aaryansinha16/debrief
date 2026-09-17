import { Module } from '@nestjs/common';

import { EventsModule } from '../events/events.module.js';
import { EventsController } from './events.controller.js';

@Module({
  imports: [EventsModule],
  controllers: [EventsController],
})
export class IngestModule {}
