import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { CONFIG, type Config } from '../config/config.js';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [CONFIG],
      useFactory: (config: Config) => ({
        pinoHttp: {
          level: config.LOG_LEVEL,
          redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], remove: true },
          ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
        },
      }),
    }),
  ],
})
export class LoggingModule {}
