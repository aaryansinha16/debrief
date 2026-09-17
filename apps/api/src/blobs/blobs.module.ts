import { Module } from '@nestjs/common';

import { BlobsService } from './blobs.service.js';

@Module({
  providers: [BlobsService],
  exports: [BlobsService],
})
export class BlobsModule {}
