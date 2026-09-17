import type { Event } from '@debrief/schema';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import type { ListenMeta, Sql } from 'postgres';

import { SQL_CLIENT } from '../db/db.module.js';
import {
  type AppendNotification,
  EVENTS_CHANNEL,
  EventsRepository,
} from '../events/events.repository.js';

export interface Subscriber {
  tenantId: string;
  runId?: string;
  lastSeq: number;
  send(event: Event): boolean;
  close(): void;
}

// One LISTEN connection per process; each subscriber catches up from its own lastSeq so coalesced or lost notifies are harmless.
@Injectable()
export class LiveService implements OnModuleInit, OnModuleDestroy {
  private readonly subscribers = new Set<Subscriber>();
  private readonly pumping = new Map<Subscriber, Promise<void>>();
  private listener: ListenMeta | undefined;

  constructor(
    @Inject(SQL_CLIENT) private readonly sql: Sql,
    private readonly events: EventsRepository,
    private readonly logger: Logger,
  ) {}

  async onModuleInit(): Promise<void> {
    this.listener = await this.sql.listen(EVENTS_CHANNEL, (payload) => {
      let notification: AppendNotification;
      try {
        notification = JSON.parse(payload) as AppendNotification;
      } catch {
        return;
      }
      for (const subscriber of this.subscribers) {
        if (subscriber.tenantId === notification.tenantId) this.pump(subscriber);
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    for (const subscriber of this.subscribers) subscriber.close();
    this.subscribers.clear();
    await this.listener?.unlisten();
  }

  async headSeq(tenantId: string): Promise<number> {
    return (await this.events.head(tenantId))?.seq ?? -1;
  }

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    this.pump(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  async pumped(subscriber: Subscriber): Promise<void> {
    await this.pumping.get(subscriber);
  }

  private pump(subscriber: Subscriber): void {
    const previous = this.pumping.get(subscriber) ?? Promise.resolve();
    const next = previous
      .then(() => this.drain(subscriber))
      .catch((error: unknown) => {
        this.logger.warn({ err: error, tenantId: subscriber.tenantId }, 'live pump failed');
      })
      .finally(() => {
        if (this.pumping.get(subscriber) === next) this.pumping.delete(subscriber);
      });
    this.pumping.set(subscriber, next);
  }

  private async drain(subscriber: Subscriber): Promise<void> {
    for (;;) {
      if (!this.subscribers.has(subscriber)) return;
      const batch = await this.events.list(subscriber.tenantId, subscriber.lastSeq + 1, 500);
      if (batch.length === 0) return;
      for (const event of batch) {
        subscriber.lastSeq = event.seq;
        if (subscriber.runId !== undefined && event.runId !== subscriber.runId) continue;
        if (!subscriber.send(event)) return;
      }
      if (batch.length < 500) return;
    }
  }
}
