import { Module } from '@nestjs/common';

import { CaptureModule } from '../capture/capture.module.js';
import { CheckpointsModule } from '../checkpoints/checkpoints.module.js';
import { EventsModule } from '../events/events.module.js';
import { EventsController } from './events.controller.js';

@Module({
  imports: [EventsModule, CheckpointsModule, CaptureModule],
  controllers: [EventsController],
})
export class IngestModule {}
