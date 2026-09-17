import { Global, Module } from '@nestjs/common';

import { CONFIG, type Config } from '../config/config.js';
import { SIGNING_KEY, loadSigningKey } from './signing-key.js';

@Global()
@Module({
  providers: [
    {
      provide: SIGNING_KEY,
      useFactory: (config: Config) => loadSigningKey(config),
      inject: [CONFIG],
    },
  ],
  exports: [SIGNING_KEY],
})
export class SigningModule {}
