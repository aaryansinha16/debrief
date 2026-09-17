import { GENESIS_HASH, hashEvent } from '@debrief/chain';
import { type Event, type EventInput, redactEvent } from '@debrief/schema';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import { DB, type Db } from '../db/db.module.js';
import { eventSources, events } from '../db/schema.js';
import { TenantKeysService } from '../tenants/tenant-keys.service.js';

export const EVENTS_CHANNEL = 'debrief_events';

export interface AppendNotification {
  tenantId: string;
  fromSeq: number;
  toSeq: number;
}

export interface AppendItem {
  input: EventInput;
  sourceId?: string;
}

export interface AppendResult {
  events: Event[];
  duplicates: number;
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
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tenantKeys: TenantKeysService,
  ) {}

  // ARCHITECTURE §6.3 and §6.4: redaction runs here, before the single writer takes the tenant lock.
  async append(tenantId: string, rawItems: readonly AppendItem[]): Promise<AppendResult> {
    if (rawItems.length === 0) return { events: [], duplicates: 0 };
    const salt = await this.tenantKeys.saltFor(tenantId);
    const items = rawItems.map((item) => ({ ...item, input: redactEvent(item.input, { salt }) }));
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${tenantId}, 0))`);
      const seen = await this.knownSourceIds(tx, tenantId, items);
      const fresh: AppendItem[] = [];
      for (const item of items) {
        if (item.sourceId === undefined) {
          fresh.push(item);
          continue;
        }
        const key = `${item.input.source}\u0000${item.sourceId}`;
        if (!seen.has(key)) {
          seen.add(key);
          fresh.push(item);
        }
      }
      const duplicates = items.length - fresh.length;
      if (fresh.length === 0) return { events: [], duplicates };
      const [head] = await tx
        .select({ seq: events.seq, hash: events.hash })
        .from(events)
        .where(eq(events.tenantId, tenantId))
        .orderBy(desc(events.seq))
        .limit(1);
      let seq = head === undefined ? 0 : head.seq + 1;
      let prevHash = head?.hash ?? GENESIS_HASH;
      const chained: Event[] = [];
      const sources: (typeof eventSources.$inferInsert)[] = [];
      for (const { input, sourceId } of fresh) {
        const unhashed = { ...input, tenantId, seq };
        const hash = hashEvent(prevHash, unhashed);
        chained.push({ ...unhashed, prevHash, hash });
        if (sourceId !== undefined) sources.push({ tenantId, source: input.source, sourceId, seq });
        prevHash = hash;
        seq += 1;
      }
      await tx.insert(events).values(chained);
      if (sources.length > 0) await tx.insert(eventSources).values(sources);
      const notification: AppendNotification = {
        tenantId,
        fromSeq: chained[0]?.seq ?? 0,
        toSeq: seq - 1,
      };
      await tx.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify(notification)})`);
      return { events: chained, duplicates };
    });
  }

  private async knownSourceIds(
    tx: Pick<Db, 'select'>,
    tenantId: string,
    items: readonly AppendItem[],
  ): Promise<Set<string>> {
    const ids = items.flatMap((item) => (item.sourceId === undefined ? [] : [item.sourceId]));
    if (ids.length === 0) return new Set();
    const rows = await tx
      .select({ source: eventSources.source, sourceId: eventSources.sourceId })
      .from(eventSources)
      .where(and(eq(eventSources.tenantId, tenantId), inArray(eventSources.sourceId, ids)));
    return new Set(rows.map((row) => `${row.source}\u0000${row.sourceId}`));
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

  async headOfRun(tenantId: string, runId: string): Promise<number | undefined> {
    const [row] = await this.db
      .select({ seq: events.seq })
      .from(events)
      .where(and(eq(events.tenantId, tenantId), eq(events.runId, runId)))
      .orderBy(desc(events.seq))
      .limit(1);
    return row?.seq;
  }

  async findById(tenantId: string, id: string): Promise<Event | undefined> {
    const [row] = await this.db
      .select()
      .from(events)
      .where(and(eq(events.tenantId, tenantId), eq(events.id, id)))
      .limit(1);
    return row === undefined ? undefined : toEvent(row);
  }

  async findBySeq(tenantId: string, seq: number): Promise<Event | undefined> {
    const [row] = await this.db
      .select()
      .from(events)
      .where(and(eq(events.tenantId, tenantId), eq(events.seq, seq)))
      .limit(1);
    return row === undefined ? undefined : toEvent(row);
  }

  async listByRun(
    tenantId: string,
    runId: string,
    fromSeq: number,
    toSeq: number | undefined,
    limit: number,
  ): Promise<Event[]> {
    const conditions = [
      eq(events.tenantId, tenantId),
      eq(events.runId, runId),
      gte(events.seq, fromSeq),
    ];
    if (toSeq !== undefined) conditions.push(lte(events.seq, toSeq));
    const rows = await this.db
      .select()
      .from(events)
      .where(and(...conditions))
      .orderBy(asc(events.seq))
      .limit(limit);
    return rows.map(toEvent);
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

  async *scan(
    tenantId: string,
    batchSize = 1000,
    fromSeq = 0,
  ): AsyncGenerator<Event, void, undefined> {
    for (;;) {
      const batch = await this.list(tenantId, fromSeq, batchSize);
      yield* batch;
      const last = batch[batch.length - 1];
      if (last === undefined || batch.length < batchSize) return;
      fromSeq = last.seq + 1;
    }
  }
}
