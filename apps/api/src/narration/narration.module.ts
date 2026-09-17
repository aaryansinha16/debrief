import { Module } from '@nestjs/common';

import { ReconstructionModule } from '../reconstruction/reconstruction.module.js';
import { NarrationController } from './narration.controller.js';
import { NarrationService } from './narration.service.js';

@Module({
  imports: [ReconstructionModule],
  controllers: [NarrationController],
  providers: [NarrationService],
})
export class NarrationModule {}
