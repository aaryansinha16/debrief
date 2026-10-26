import type { Event } from '@debrief/schema';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, sql } from 'drizzle-orm';

import { DB, type Db } from '../db/db.module.js';
import { events } from '../db/schema.js';
import { toEvent } from '../events/events.repository.js';
import { type Span, isSessionEvent, sourceMillis } from './session-check.js';

export interface SessionSummary {
  id: string;
  startedAt: string;
  lastMessageAt: string;
  messages: number;
  claims: number;
  verdicts: number;
  checkedAt?: string;
}

// An event is never ingested long before it happened: `ts` bounds `sourceTs` from below, with an hour for clock skew.
const SKEW_MS = 60 * 60 * 1000;
const MAX_OBSERVED = 20_000;

const ingestedSince = (fromMs: number): string => new Date(fromMs - SKEW_MS).toISOString();

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
      with sessions as (
        select run_id, min(ts) as started_at, max(ts) as last_message_at, count(*)::int as messages
        from ${events}
        where tenant_id = ${tenantId} and kind = 'agent.message'
        group by run_id
        order by max(ts) desc
        limit ${limit}
      ),
      derived as (
        select d.run_id,
               count(*) filter (where d.kind = 'claim')::int as claims,
               count(*) filter (where d.kind = 'verdict')::int as verdicts,
               max(d.ts) filter (where d.kind = 'verdict') as checked_at
        from ${events} d
        where d.tenant_id = ${tenantId} and d.kind in ('claim', 'verdict')
          and d.run_id in (select run_id from sessions)
        group by d.run_id
      )
      select s.run_id, s.started_at, s.last_message_at, s.messages,
             coalesce(d.claims, 0) as claims, coalesce(d.verdicts, 0) as verdicts, d.checked_at
      from sessions s left join derived d on d.run_id = s.run_id
      order by s.last_message_at desc
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

  // Sessions whose reported span, padded by the margins, meets the given source-time span; compared in JS, never cast in SQL.
  async around(tenantId: string, span: Span, beforeMs: number, afterMs: number): Promise<string[]> {
    const rows = await this.db
      .select({
        runId: events.runId,
        kind: events.kind,
        sourceTs: events.sourceTs,
      })
      .from(events)
      .where(
        and(
          eq(events.tenantId, tenantId),
          eq(events.provenance, 'reported'),
          gte(events.ts, ingestedSince(span.from - afterMs)),
        ),
      );
    const spans = new Map<string, Span & { session: boolean }>();
    for (const row of rows) {
      const at = sourceMillis(row);
      if (at === undefined) continue;
      const current = spans.get(row.runId) ?? { from: at, to: at, session: false };
      current.from = Math.min(current.from, at);
      current.to = Math.max(current.to, at);
      current.session ||= isSessionEvent({ kind: row.kind } as Event);
      spans.set(row.runId, current);
    }
    return [...spans]
      .filter(([, s]) => s.session && s.from - beforeMs <= span.to && s.to + afterMs >= span.from)
      .map(([runId]) => runId);
  }

  // Observed events ingested since the window opened; the caller applies the window on source time.
  async observedSince(tenantId: string, fromMs: number): Promise<Event[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(
        and(
          eq(events.tenantId, tenantId),
          eq(events.provenance, 'observed'),
          gte(events.ts, ingestedSince(fromMs)),
        ),
      )
      .orderBy(asc(events.seq))
      .limit(MAX_OBSERVED);
    return rows.map(toEvent);
  }
}
