import { Global, Module } from '@nestjs/common';

import { CONFIG, type Config } from '../config/config.js';
import { OBJECT_STORE, S3ObjectStore } from './object-store.js';

@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORE,
      useFactory: (config: Config) => S3ObjectStore.fromConfig(config),
      inject: [CONFIG],
    },
  ],
  exports: [OBJECT_STORE],
})
export class StorageModule {}
