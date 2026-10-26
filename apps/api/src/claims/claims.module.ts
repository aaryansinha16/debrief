import { Module } from '@nestjs/common';

import { BlobsModule } from '../blobs/blobs.module.js';
import { CheckpointsModule } from '../checkpoints/checkpoints.module.js';
import { EventsModule } from '../events/events.module.js';
import { RunsModule } from '../runs/runs.module.js';
import { ClaimsController } from './claims.controller.js';
import { ClaimsService } from './claims.service.js';

@Module({
  imports: [EventsModule, BlobsModule, CheckpointsModule, RunsModule],
  controllers: [ClaimsController],
  providers: [ClaimsService],
  exports: [ClaimsService],
})
export class ClaimsModule {}
