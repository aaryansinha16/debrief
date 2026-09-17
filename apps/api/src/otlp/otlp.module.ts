import { Module } from '@nestjs/common';

import { BlobsModule } from '../blobs/blobs.module.js';
import { CheckpointsModule } from '../checkpoints/checkpoints.module.js';
import { EventsModule } from '../events/events.module.js';
import { OtlpService } from './otlp.service.js';
import { TracesController } from './traces.controller.js';

@Module({
  imports: [EventsModule, CheckpointsModule, BlobsModule],
  controllers: [TracesController],
  providers: [OtlpService],
  exports: [OtlpService],
})
export class OtlpModule {}
