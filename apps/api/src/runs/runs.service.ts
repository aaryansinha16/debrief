import type { Event, Run } from '@debrief/schema';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { CONFIG, type Config } from '../config/config.js';
import { RunsRepository } from './runs.repository.js';

const keyOf = (tenantId: string, runId: string): string => JSON.stringify([tenantId, runId]);

// Debounced per (tenant, run): ingest only schedules; the recompute runs off the request path.
@Injectable()
export class RunsService implements OnModuleDestroy {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private inflight: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly runs: RunsRepository,
    private readonly logger: Logger,
  ) {}

  observe(tenantId: string, appended: readonly Event[]): void {
    for (const runId of new Set(appended.map((event) => event.runId))) {
      const key = keyOf(tenantId, runId);
      const existing = this.timers.get(key);
      if (existing !== undefined) clearTimeout(existing);
      const timer = setTimeout(() => {
        this.timers.delete(key);
        this.inflight = this.inflight
          .then(() => this.runs.materialize(tenantId, runId))
          .catch((error: unknown) => {
            this.logger.error({ err: error, tenantId, runId }, 'run materialization failed');
          });
      }, this.config.RUN_DEBOUNCE_MS);
      timer.unref();
      this.timers.set(key, timer);
    }
  }

  async settle(): Promise<void> {
    for (const [key, timer] of this.timers) {
      clearTimeout(timer);
      this.timers.delete(key);
      const [tenantId, runId] = JSON.parse(key) as [string, string];
      this.inflight = this.inflight.then(() => this.runs.materialize(tenantId, runId));
    }
    await this.inflight;
  }

  async get(tenantId: string, runId: string): Promise<Run | undefined> {
    return (await this.runs.find(tenantId, runId)) ?? this.runs.materialize(tenantId, runId);
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
