import { GENESIS_HASH, hashEvent } from '@debrief/chain';
import type { Event, EventInput } from '@debrief/schema';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';

import { DB, type Db } from '../db/db.module.js';
import { events } from '../db/schema.js';

export const EVENTS_CHANNEL = 'debrief_events';

export interface AppendNotification {
  tenantId: string;
  fromSeq: number;
  toSeq: number;
}

type EventRow = typeof events.$inferSelect;

export function toEvent(row: EventRow): Event {
  const event: Event = {
    id: row.id,
    tenantId: row.tenantId,
    seq: row.seq,
    ts: row.ts,
    sourceTs: row.sourceTs,
    source: row.source as Event['source'],
    provenance: row.provenance as Event['provenance'],
    runId: row.runId,
    kind: row.kind as Event['kind'],
    actor: row.actor,
    attrs: row.attrs,
    prevHash: row.prevHash,
    hash: row.hash,
  };
  if (row.spanId !== null) event.spanId = row.spanId;
  if (row.parentSpanId !== null) event.parentSpanId = row.parentSpanId;
  if (row.authority !== null) event.authority = row.authority;
  if (row.target !== null) event.target = row.target;
  if (row.payloadSha256 !== null) event.payloadSha256 = row.payloadSha256;
  if (row.summary !== null) event.summary = row.summary;
  return event;
}

@Injectable()
export class EventsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ARCHITECTURE §6.3: one writer per tenant; seq and prevHash are assigned under the lock.
  async append(tenantId: string, inputs: readonly EventInput[]): Promise<Event[]> {
    if (inputs.length === 0) return [];
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${tenantId}, 0))`);
      const [head] = await tx
        .select({ seq: events.seq, hash: events.hash })
        .from(events)
        .where(eq(events.tenantId, tenantId))
        .orderBy(desc(events.seq))
        .limit(1);
      let seq = head === undefined ? 0 : head.seq + 1;
      let prevHash = head?.hash ?? GENESIS_HASH;
      const chained: Event[] = [];
      for (const input of inputs) {
        const unhashed = { ...input, tenantId, seq };
        const hash = hashEvent(prevHash, unhashed);
        chained.push({ ...unhashed, prevHash, hash });
        prevHash = hash;
        seq += 1;
      }
      await tx.insert(events).values(chained);
      const notification: AppendNotification = {
        tenantId,
        fromSeq: chained[0]?.seq ?? 0,
        toSeq: seq - 1,
      };
      await tx.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify(notification)})`);
      return chained;
    });
  }

  async head(tenantId: string): Promise<{ seq: number; hash: string } | undefined> {
    const [row] = await this.db
      .select({ seq: events.seq, hash: events.hash })
      .from(events)
      .where(eq(events.tenantId, tenantId))
      .orderBy(desc(events.seq))
      .limit(1);
    return row;
  }

  async list(tenantId: string, fromSeq = 0, limit = 1000): Promise<Event[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(and(eq(events.tenantId, tenantId), gte(events.seq, fromSeq)))
      .orderBy(asc(events.seq))
      .limit(limit);
    return rows.map(toEvent);
  }

  async *scan(tenantId: string, batchSize = 1000): AsyncGenerator<Event, void, undefined> {
    let fromSeq = 0;
    for (;;) {
      const batch = await this.list(tenantId, fromSeq, batchSize);
      yield* batch;
      const last = batch[batch.length - 1];
      if (last === undefined || batch.length < batchSize) return;
      fromSeq = last.seq + 1;
    }
  }
}
