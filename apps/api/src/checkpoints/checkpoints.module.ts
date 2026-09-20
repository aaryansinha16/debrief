import { Module } from '@nestjs/common';

import { CONFIG, type Config } from '../config/config.js';
import { EventsModule } from '../events/events.module.js';
import { ANCHORER, anchorerFor } from './anchorer.js';
import { CheckpointerService } from './checkpointer.service.js';
import { CheckpointsController } from './checkpoints.controller.js';
import { CheckpointsRepository } from './checkpoints.repository.js';
import { TreeCache } from './tree-cache.js';

@Module({
  imports: [EventsModule],
  controllers: [CheckpointsController],
  providers: [
    CheckpointsRepository,
    TreeCache,
    CheckpointerService,
    { provide: ANCHORER, useFactory: (config: Config) => anchorerFor(config), inject: [CONFIG] },
  ],
  exports: [CheckpointerService, CheckpointsRepository, TreeCache],
})
export class CheckpointsModule {}
