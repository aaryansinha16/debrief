import { Module } from '@nestjs/common';

import { CheckpointsModule } from '../checkpoints/checkpoints.module.js';
import { ClaimsModule } from '../claims/claims.module.js';
import { EventsModule } from '../events/events.module.js';
import { RunsModule } from '../runs/runs.module.js';
import { SessionsController } from './sessions.controller.js';
import { SessionsRepository } from './sessions.repository.js';
import { SessionsService } from './sessions.service.js';

@Module({
  imports: [EventsModule, CheckpointsModule, ClaimsModule, RunsModule],
  controllers: [SessionsController],
  providers: [SessionsRepository, SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
