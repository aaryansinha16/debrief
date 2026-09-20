import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module.js';
import { BODY_LIMIT_BYTES, applyHardening } from './hardening.js';
import { PROTOBUF } from './otlp/traces.controller.js';

export { BODY_LIMIT_BYTES } from './hardening.js';

export async function createApp(): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({ bodyLimit: BODY_LIMIT_BYTES });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  applyHardening(fastify);
  fastify.addContentTypeParser(PROTOBUF, { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  return app;
}
