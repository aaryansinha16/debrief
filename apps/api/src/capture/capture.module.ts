import { Module } from '@nestjs/common';

import { BlobsModule } from '../blobs/blobs.module.js';
import { CaptureService } from './capture.service.js';

@Module({
  imports: [BlobsModule],
  providers: [CaptureService],
  exports: [CaptureService],
})
export class CaptureModule {}
