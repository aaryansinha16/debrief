import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defaultMigrationsFolder, runMigrations } from './migrate.js';
import { adminUrlFromEnv, createTempDatabase, type TempDatabase } from '../test/temp-db.js';

const adminUrl = adminUrlFromEnv();

const connect = (url: string): Sql => postgres(url, { max: 1, onnotice: () => undefined });

const insertEvent = (client: Sql, seq: number): Promise<unknown> =>
  client.unsafe(
    `INSERT INTO events (tenant_id, seq, id, ts, source_ts, source, provenance, run_id, kind, actor, attrs, prev_hash, hash)
     VALUES ('t1', ${String(seq)}, '01J8ZK5R4M2X6P9Q3V7W1Y5N${String(seq).padStart(2, '0')}', '2026-09-17T00:00:00.000Z', '2026-09-17T00:00:00.000Z',
             'api', 'reported', 'run-1', 'agent.invoke', '{"type":"agent","id":"a"}', '{}', '${'0'.repeat(64)}', '${'ab'.repeat(32)}')`,
  );

describe.skipIf(adminUrl === undefined)('migrations', () => {
  let temp: TempDatabase;
  let admin: Sql;
  let app: Sql;

  beforeAll(async () => {
    temp = await createTempDatabase(adminUrl!);
    await runMigrations({ adminUrl: temp.adminUrl, appRole: temp.role });
    await runMigrations({ adminUrl: temp.adminUrl, appRole: temp.role });
    admin = connect(temp.adminUrl);
    app = connect(temp.appUrl);
    await admin.unsafe(`INSERT INTO tenants (id, name) VALUES ('t1', 'Tenant One')`);
    await insertEvent(admin, 0);
  });

  afterAll(async () => {
    await admin.end();
    await app.end();
    await temp.drop();
  });

  it('is idempotent and creates every table', async () => {
    const applied = await admin.unsafe(
      `SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`,
    );
    expect(applied[0]?.n).toBe(4);
    const tables = await admin.unsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    expect(tables.map((row) => String(row.table_name))).toEqual([
      'api_keys',
      'blobs',
      'checkpoints',
      'event_sources',
      'events',
      'evidence_jobs',
      'narratives',
      'policies',
      'runs',
      'tenant_keys',
      'tenants',
    ]);
  });

  it.each([
    [`UPDATE events SET summary = 'x' WHERE seq = 0`],
    [`UPDATE events SET summary = 'x' WHERE seq = 999`],
    [`DELETE FROM events WHERE seq = 0`],
    [`DELETE FROM events WHERE seq = 999`],
    [`TRUNCATE events CASCADE`],
  ])('raises for the owner on %s', async (statement) => {
    await expect(admin.unsafe(statement)).rejects.toThrow(/append-only/);
    const rows = await admin.unsafe(`SELECT count(*)::int AS n FROM events`);
    expect(rows[0]?.n).toBe(1);
  });

  it('lets the app role insert but never update, delete or truncate events', async () => {
    await insertEvent(app, 1);
    const rows = await app.unsafe(`SELECT seq FROM events ORDER BY seq`);
    expect(rows.map((row) => Number(row.seq))).toEqual([0, 1]);
    await expect(app.unsafe(`UPDATE events SET summary = 'x'`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.unsafe(`DELETE FROM events`)).rejects.toThrow(/permission denied/);
    await expect(app.unsafe(`TRUNCATE events`)).rejects.toThrow(/permission denied/);
  });

  it('grants the app role no delete on any table', async () => {
    const grants = await admin.unsafe(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
       WHERE grantee = '${temp.role}' AND table_schema = 'public' ORDER BY table_name, privilege_type`,
    );
    const byTable = new Map<string, string[]>();
    for (const row of grants) {
      const list = byTable.get(String(row.table_name)) ?? [];
      list.push(String(row.privilege_type));
      byTable.set(String(row.table_name), list);
    }
    expect(byTable.get('events')).toEqual(['INSERT', 'SELECT']);
    expect(byTable.get('checkpoints')).toEqual(['INSERT', 'SELECT']);
    expect(byTable.get('runs')).toEqual(['INSERT', 'SELECT', 'UPDATE']);
    expect(byTable.get('tenant_keys')).toEqual(['INSERT', 'SELECT', 'UPDATE']);
    for (const privileges of byTable.values()) expect(privileges).not.toContain('DELETE');
  });

  it('keeps third-party trust on keys issued before 0003 and gives new keys local', async () => {
    const earlier = await createTempDatabase(adminUrl!);
    const folder = mkdtempSync(join(tmpdir(), 'debrief-migrations-'));
    const client = connect(earlier.adminUrl);
    try {
      cpSync(defaultMigrationsFolder, folder, { recursive: true });
      const journalFile = join(folder, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as {
        entries: { tag: string }[];
      };
      journal.entries = journal.entries.filter((entry) => entry.tag !== '0003_key_trust');
      writeFileSync(journalFile, JSON.stringify(journal));
      await runMigrations({
        adminUrl: earlier.adminUrl,
        appRole: earlier.role,
        migrationsFolder: folder,
      });
      await client.unsafe(`INSERT INTO tenants (id, name) VALUES ('t1', 'Tenant One')`);
      await client.unsafe(
        `INSERT INTO api_keys (id, tenant_id, key_hash, prefix, name) VALUES ('k-old', 't1', 'h-old', 'dbf_old', 'old')`,
      );
      await runMigrations({ adminUrl: earlier.adminUrl, appRole: earlier.role });
      await client.unsafe(
        `INSERT INTO api_keys (id, tenant_id, key_hash, prefix, name) VALUES ('k-new', 't1', 'h-new', 'dbf_new', 'new')`,
      );
      const rows = await client.unsafe(`SELECT id, trust FROM api_keys ORDER BY id`);
      expect(rows.map((row) => [String(row.id), String(row.trust)])).toEqual([
        ['k-new', 'local'],
        ['k-old', 'third-party'],
      ]);
    } finally {
      await client.end();
      rmSync(folder, { recursive: true, force: true });
      await earlier.drop();
    }
  });

  it('rejects an unsafe role name before touching the database', async () => {
    await expect(
      runMigrations({ adminUrl: temp.adminUrl, appRole: 'x"; DROP ROLE y' }),
    ).rejects.toThrow(/invalid app role/);
  });
});
