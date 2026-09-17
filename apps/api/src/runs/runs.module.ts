import { Module } from '@nestjs/common';

import { EventsModule } from '../events/events.module.js';
import { RunsController } from './runs.controller.js';
import { RunsRepository } from './runs.repository.js';
import { RunsService } from './runs.service.js';

@Module({
  imports: [EventsModule],
  controllers: [RunsController],
  providers: [RunsRepository, RunsService],
  exports: [RunsService, RunsRepository],
})
export class RunsModule {}
