import { Module } from '@nestjs/common';

import { BlobsModule } from '../blobs/blobs.module.js';
import { CheckpointsModule } from '../checkpoints/checkpoints.module.js';
import { ReconstructionModule } from '../reconstruction/reconstruction.module.js';
import { RunsModule } from '../runs/runs.module.js';
import { EvidenceController } from './evidence.controller.js';
import { EvidenceService } from './evidence.service.js';

@Module({
  imports: [ReconstructionModule, RunsModule, CheckpointsModule, BlobsModule],
  controllers: [EvidenceController],
  providers: [EvidenceService],
})
export class EvidenceModule {}
