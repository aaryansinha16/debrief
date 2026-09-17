import { Module } from '@nestjs/common';

import { EventsModule } from '../events/events.module.js';
import { CheckpointerService } from './checkpointer.service.js';
import { CheckpointsController } from './checkpoints.controller.js';
import { CheckpointsRepository } from './checkpoints.repository.js';
import { TreeCache } from './tree-cache.js';

@Module({
  imports: [EventsModule],
  controllers: [CheckpointsController],
  providers: [CheckpointsRepository, TreeCache, CheckpointerService],
  exports: [CheckpointerService, CheckpointsRepository, TreeCache],
})
export class CheckpointsModule {}
