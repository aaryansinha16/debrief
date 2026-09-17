import type { Run } from '@debrief/schema';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt, or, sql } from 'drizzle-orm';

import { DB, type Db } from '../db/db.module.js';
import { events, runs } from '../db/schema.js';

type RunRow = typeof runs.$inferSelect;

export function toRun(row: RunRow): Run {
  const run: Run = {
    id: row.id,
    tenantId: row.tenantId,
    principalId: row.principalId,
    agentName: row.agentName,
    startedAt: row.startedAt,
    eventCount: row.eventCount,
    status: row.status,
    divergenceCount: row.divergenceCount,
    graphVersion: row.graphVersion,
  };
  if (row.endedAt !== null) run.endedAt = row.endedAt;
  if (row.riskMax !== null) run.riskMax = row.riskMax;
  if (row.layout !== null) run.layout = row.layout;
  return run;
}

export interface RunPage {
  runs: Run[];
  nextCursor?: string;
}

export interface RunCursor {
  startedAt: string;
  id: string;
}

const RISK_RANK = sql`case coalesce(${events.target}->>'risk', '')
  when 'critical' then 4 when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end`;
const RISKS = [undefined, 'low', 'medium', 'high', 'critical'] as const;

@Injectable()
export class RunsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ARCHITECTURE §4.4: recomputed from the events table; the row is a cache, never a source of truth.
  async materialize(tenantId: string, runId: string): Promise<Run | undefined> {
    const scope = and(eq(events.tenantId, tenantId), eq(events.runId, runId));
    const [stats] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        startedAt: sql<string | null>`min(${events.ts})`,
        endedAt: sql<string | null>`max(${events.ts})`,
        riskRank: sql<number>`coalesce(max(${RISK_RANK}), 0)::int`,
        ended: sql<number>`count(*) filter (where ${events.kind} = 'agent.invoke')::int`,
        divergences: sql<number>`count(*) filter (where ${events.kind} = 'policy.decision' and coalesce(${events.attrs}->>'policy.effect', 'allow') <> 'allow')::int`,
      })
      .from(events)
      .where(scope);
    if (stats === undefined || stats.count === 0 || stats.startedAt === null) return undefined;
    const [principal] = await this.db
      .select({
        id: sql<string>`coalesce(${events.authority}->>'principalId', ${events.actor}->>'id')`,
      })
      .from(events)
      .where(
        and(scope, or(eq(events.kind, 'principal.session'), sql`${events.authority} is not null`)),
      )
      .orderBy(events.seq)
      .limit(1);
    const [agent] = await this.db
      .select({ name: sql<string>`coalesce(${events.actor}->>'name', ${events.actor}->>'id')` })
      .from(events)
      .where(and(scope, sql`${events.actor}->>'type' in ('agent', 'subagent')`))
      .orderBy(events.seq)
      .limit(1);
    const row: typeof runs.$inferInsert = {
      tenantId,
      id: runId,
      principalId: principal?.id ?? 'unknown',
      agentName: agent?.name ?? 'unknown',
      startedAt: stats.startedAt,
      endedAt: stats.ended > 0 ? stats.endedAt : null,
      eventCount: stats.count,
      status: stats.ended > 0 ? 'ended' : 'active',
      riskMax: RISKS[stats.riskRank] ?? null,
      divergenceCount: stats.divergences,
    };
    const [stored] = await this.db
      .insert(runs)
      .values(row)
      .onConflictDoUpdate({
        target: [runs.tenantId, runs.id],
        set: {
          principalId: row.principalId,
          agentName: row.agentName,
          startedAt: row.startedAt,
          endedAt: row.endedAt,
          eventCount: row.eventCount,
          status: row.status,
          riskMax: row.riskMax,
          divergenceCount: row.divergenceCount,
        },
      })
      .returning();
    return stored === undefined ? undefined : toRun(stored);
  }

  async find(tenantId: string, runId: string): Promise<Run | undefined> {
    const [row] = await this.db
      .select()
      .from(runs)
      .where(and(eq(runs.tenantId, tenantId), eq(runs.id, runId)))
      .limit(1);
    return row === undefined ? undefined : toRun(row);
  }

  // Newest first; the cursor is the (startedAt, id) of the last row, so concurrent inserts never shift a page.
  async list(
    tenantId: string,
    limit: number,
    cursor?: RunCursor,
    since?: string,
  ): Promise<RunPage> {
    const conditions = [eq(runs.tenantId, tenantId)];
    if (since !== undefined) conditions.push(gte(runs.startedAt, since));
    if (cursor !== undefined) {
      const older = or(
        lt(runs.startedAt, cursor.startedAt),
        and(eq(runs.startedAt, cursor.startedAt), lt(runs.id, cursor.id)),
      );
      if (older !== undefined) conditions.push(older);
    }
    const rows = await this.db
      .select()
      .from(runs)
      .where(and(...conditions))
      .orderBy(desc(runs.startedAt), desc(runs.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit).map(toRun);
    const last = page[page.length - 1];
    return rows.length > limit && last !== undefined
      ? { runs: page, nextCursor: encodeRunCursor(last) }
      : { runs: page };
  }
}

export const encodeRunCursor = (run: Pick<Run, 'startedAt' | 'id'>): string =>
  Buffer.from(`${run.startedAt}|${run.id}`, 'utf8').toString('base64url');

export function decodeRunCursor(cursor: string): RunCursor | undefined {
  const [startedAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  return startedAt === undefined || id === undefined || startedAt === '' || id === ''
    ? undefined
    : { startedAt, id };
}
