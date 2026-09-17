import { Module } from '@nestjs/common';

import { CaptureModule } from '../capture/capture.module.js';
import { CheckpointsModule } from '../checkpoints/checkpoints.module.js';
import { EventsModule } from '../events/events.module.js';
import { RunsModule } from '../runs/runs.module.js';
import { OtlpService } from './otlp.service.js';
import { TracesController } from './traces.controller.js';

@Module({
  imports: [EventsModule, CheckpointsModule, CaptureModule, RunsModule],
  controllers: [TracesController],
  providers: [OtlpService],
  exports: [OtlpService],
})
export class OtlpModule {}
