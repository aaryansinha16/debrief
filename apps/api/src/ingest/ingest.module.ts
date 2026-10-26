import { Module } from '@nestjs/common';

import { CaptureModule } from '../capture/capture.module.js';
import { CheckpointsModule } from '../checkpoints/checkpoints.module.js';
import { EventsModule } from '../events/events.module.js';
import { RunsModule } from '../runs/runs.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { EventsController } from './events.controller.js';

@Module({
  imports: [EventsModule, CheckpointsModule, CaptureModule, RunsModule, SessionsModule],
  controllers: [EventsController],
})
export class IngestModule {}
