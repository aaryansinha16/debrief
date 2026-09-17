import { Module } from '@nestjs/common';

import { EventsRepository } from './events.repository.js';

@Module({
  providers: [EventsRepository],
  exports: [EventsRepository],
})
export class EventsModule {}
