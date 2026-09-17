import { Module } from '@nestjs/common';

import { CheckpointsModule } from '../checkpoints/checkpoints.module.js';
import { EventsModule } from '../events/events.module.js';
import { EventsController } from './events.controller.js';

@Module({
  imports: [EventsModule, CheckpointsModule],
  controllers: [EventsController],
})
export class IngestModule {}
