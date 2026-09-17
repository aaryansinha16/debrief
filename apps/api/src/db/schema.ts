import type { Actor, Authority, Target, Attrs, Anchor } from '@debrief/schema';
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow();

export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  captureMode: text('capture_mode', { enum: ['off', 'summary', 'on'] })
    .notNull()
    .default('off'),
  createdAt: createdAt(),
});

export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    keyHash: text('key_hash').notNull(),
    prefix: text('prefix').notNull(),
    name: text('name').notNull(),
    createdAt: createdAt(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
  },
  (t) => [
    uniqueIndex('api_keys_key_hash_idx').on(t.keyHash),
    index('api_keys_tenant_idx').on(t.tenantId),
  ],
);

export const events = pgTable(
  'events',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    id: text('id').notNull(),
    ts: text('ts').notNull(),
    sourceTs: text('source_ts').notNull(),
    source: text('source').notNull(),
    provenance: text('provenance').notNull(),
    runId: text('run_id').notNull(),
    spanId: text('span_id'),
    parentSpanId: text('parent_span_id'),
    kind: text('kind').notNull(),
    actor: jsonb('actor').$type<Actor>().notNull(),
    authority: jsonb('authority').$type<Authority>(),
    target: jsonb('target').$type<Target>(),
    attrs: jsonb('attrs').$type<Attrs>().notNull(),
    payloadSha256: text('payload_sha256'),
    summary: text('summary'),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.seq] }),
    uniqueIndex('events_tenant_id_idx').on(t.tenantId, t.id),
    index('events_tenant_run_seq_idx').on(t.tenantId, t.runId, t.seq),
    index('events_tenant_ts_idx').on(t.tenantId, t.ts),
    index('events_tenant_kind_idx').on(t.tenantId, t.kind),
  ],
);

export const eventSources = pgTable(
  'event_sources',
  {
    tenantId: text('tenant_id').notNull(),
    source: text('source').notNull(),
    sourceId: text('source_id').notNull(),
    seq: bigint('seq', { mode: 'number' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.source, t.sourceId] }),
    foreignKey({ columns: [t.tenantId, t.seq], foreignColumns: [events.tenantId, events.seq] }),
  ],
);

export const blobs = pgTable(
  'blobs',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    sha256: text('sha256').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    mime: text('mime').notNull(),
    encrypted: boolean('encrypted').notNull(),
    keyId: text('key_id'),
    storageKey: text('storage_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.sha256] })],
);

export const checkpoints = pgTable(
  'checkpoints',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    treeSize: bigint('tree_size', { mode: 'number' }).notNull(),
    rootHash: text('root_hash').notNull(),
    headHash: text('head_hash').notNull(),
    ts: text('ts').notNull(),
    keyId: text('key_id').notNull(),
    signature: text('signature').notNull(),
    anchor: jsonb('anchor').$type<Anchor>(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.treeSize] })],
);

export const runs = pgTable(
  'runs',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    id: text('id').notNull(),
    principalId: text('principal_id').notNull(),
    agentName: text('agent_name').notNull(),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    eventCount: integer('event_count').notNull().default(0),
    status: text('status', { enum: ['active', 'ended'] }).notNull(),
    riskMax: text('risk_max', { enum: ['low', 'medium', 'high', 'critical'] }),
    divergenceCount: integer('divergence_count').notNull().default(0),
    layout: jsonb('layout').$type<Record<string, unknown>>(),
    graphVersion: integer('graph_version').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    index('runs_tenant_started_idx').on(t.tenantId, t.startedAt),
  ],
);

export const policies = pgTable(
  'policies',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    yaml: text('yaml').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [index('policies_tenant_idx').on(t.tenantId)],
);

export const evidenceJobs = pgTable(
  'evidence_jobs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    runId: text('run_id').notNull(),
    status: text('status', { enum: ['queued', 'running', 'done', 'failed'] })
      .notNull()
      .default('queued'),
    storageKey: text('storage_key'),
    error: text('error'),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
  },
  (t) => [index('evidence_jobs_tenant_run_idx').on(t.tenantId, t.runId)],
);
