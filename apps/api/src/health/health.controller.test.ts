import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import type { Db } from '../db/db.module.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('healthz is always ok', () => {
    const controller = new HealthController({} as Db);
    expect(controller.healthz()).toEqual({ status: 'ok' });
  });

  it('readyz is ok when the database answers and 503 when it does not', async () => {
    const up = { execute: () => Promise.resolve([]) } as unknown as Db;
    await expect(new HealthController(up).readyz()).resolves.toEqual({ status: 'ok' });
    const down = { execute: () => Promise.reject(new Error('refused')) } as unknown as Db;
    await expect(new HealthController(down).readyz()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
