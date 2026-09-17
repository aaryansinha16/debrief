import { Module } from '@nestjs/common';

import { EventsModule } from '../events/events.module.js';
import { RunsModule } from '../runs/runs.module.js';
import { ReconstructionController } from './reconstruction.controller.js';
import { ReconstructionService } from './reconstruction.service.js';

@Module({
  imports: [EventsModule, RunsModule],
  controllers: [ReconstructionController],
  providers: [ReconstructionService],
})
export class ReconstructionModule {}
