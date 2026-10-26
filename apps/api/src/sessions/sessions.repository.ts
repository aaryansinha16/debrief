import type { Event } from '@debrief/schema';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { DB, type Db } from '../db/db.module.js';
import { events } from '../db/schema.js';
import { toEvent } from '../events/events.repository.js';

export interface SessionSummary {
  id: string;
  startedAt: string;
  lastMessageAt: string;
  messages: number;
  claims: number;
  verdicts: number;
  checkedAt?: string;
}

@Injectable()
export class SessionsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  // Sessions are the runs that hold the assistant's messages; derived from events, never stored.
  async list(tenantId: string, limit: number): Promise<SessionSummary[]> {
    const rows = await this.db.execute<{
      run_id: string;
      started_at: string;
      last_message_at: string;
      messages: number;
      claims: number;
      verdicts: number;
      checked_at: string | null;
    }>(sql`
      select m.run_id,
             min(m.ts) as started_at,
             max(m.ts) as last_message_at,
             count(*)::int as messages,
             (select count(*)::int from ${events} c
               where c.tenant_id = ${tenantId} and c.run_id = m.run_id and c.kind = 'claim') as claims,
             (select count(*)::int from ${events} v
               where v.tenant_id = ${tenantId} and v.run_id = m.run_id and v.kind = 'verdict') as verdicts,
             (select max(v.ts) from ${events} v
               where v.tenant_id = ${tenantId} and v.run_id = m.run_id and v.kind = 'verdict') as checked_at
      from ${events} m
      where m.tenant_id = ${tenantId} and m.kind = 'agent.message'
      group by m.run_id
      order by max(m.ts) desc
      limit ${limit}
    `);
    return rows.map((row) => ({
      id: row.run_id,
      startedAt: row.started_at,
      lastMessageAt: row.last_message_at,
      messages: row.messages,
      claims: row.claims,
      verdicts: row.verdicts,
      ...(row.checked_at === null ? {} : { checkedAt: row.checked_at }),
    }));
  }

  // Sessions whose messages bracket the instant in source time, with the window margins the caller applies.
  async around(tenantId: string, at: string, beforeMs: number, afterMs: number): Promise<string[]> {
    const from = new Date(Date.parse(at) - afterMs).toISOString();
    const to = new Date(Date.parse(at) + beforeMs).toISOString();
    const rows = await this.db.execute<{ run_id: string }>(sql`
      select m.run_id
      from ${events} m
      where m.tenant_id = ${tenantId} and m.kind = 'agent.message'
      group by m.run_id
      having min(m.source_ts::timestamptz) <= ${to}::timestamptz
         and max(m.source_ts::timestamptz) >= ${from}::timestamptz
    `);
    return rows.map((row) => row.run_id);
  }

  // Source time, not ingest time: a witness may deliver late, and `sourceTs` carries its own offset.
  async observedBetween(tenantId: string, from: string, to: string): Promise<Event[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(
        and(
          eq(events.tenantId, tenantId),
          eq(events.provenance, 'observed'),
          sql`${events.sourceTs}::timestamptz between ${from}::timestamptz and ${to}::timestamptz`,
        ),
      )
      .orderBy(events.seq);
    return rows.map(toEvent);
  }
}
