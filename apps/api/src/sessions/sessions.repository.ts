import type { Event } from '@debrief/schema';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, sql } from 'drizzle-orm';

import { DB, type Db } from '../db/db.module.js';
import { events } from '../db/schema.js';
import { toEvent } from '../events/events.repository.js';
import { type Span, sourceMillis } from './session-check.js';

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
// A witness older than this never re-opens a session (D-091).
const MAX_LATENESS_MS = 7 * 24 * 60 * 60 * 1000;

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
        order by max(ts) desc, run_id
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
      order by s.last_message_at desc, s.run_id
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

  // Sessions whose messages, padded by the margins, meet the given source-time span; source times compared in JS.
  // Only messages ingested in the last MAX_LATENESS are read: one row per Stop, never the tenant's whole history.
  async around(tenantId: string, span: Span, beforeMs: number, afterMs: number): Promise<string[]> {
    const since = Math.max(span.from - afterMs, Date.now() - MAX_LATENESS_MS);
    const rows = await this.db
      .select({ runId: events.runId, sourceTs: events.sourceTs })
      .from(events)
      .where(
        and(
          eq(events.tenantId, tenantId),
          eq(events.kind, 'agent.message'),
          gte(events.ts, ingestedSince(since)),
        ),
      );
    const spans = new Map<string, Span>();
    for (const row of rows) {
      const at = sourceMillis(row);
      if (at === undefined) continue;
      const current = spans.get(row.runId);
      spans.set(
        row.runId,
        current === undefined
          ? { from: at, to: at }
          : { from: Math.min(current.from, at), to: Math.max(current.to, at) },
      );
    }
    return [...spans]
      .filter(([, s]) => s.from - beforeMs <= span.to && s.to + afterMs >= span.from)
      .map(([runId]) => runId);
  }

  // Observed events ingested since the window opened; the caller applies the window on source time and logs a cut.
  async observedSince(
    tenantId: string,
    fromMs: number,
  ): Promise<{ events: Event[]; truncated: boolean }> {
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
      .limit(MAX_OBSERVED + 1);
    return {
      events: rows.slice(0, MAX_OBSERVED).map(toEvent),
      truncated: rows.length > MAX_OBSERVED,
    };
  }
}
