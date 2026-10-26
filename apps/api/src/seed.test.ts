import { spawnSync } from 'node:child_process';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from './db/migrate.js';
import { adminUrlFromEnv, createTempDatabase, type TempDatabase } from './test/temp-db.js';

const adminUrl = adminUrlFromEnv();

describe.skipIf(adminUrl === undefined)('seed', () => {
  let temp: TempDatabase;

  const seed = (...args: string[]) =>
    spawnSync('pnpm', ['exec', 'tsx', 'src/seed.ts', '--tenant', 't1', ...args], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_ADMIN_URL: temp.adminUrl },
    });

  beforeAll(async () => {
    temp = await createTempDatabase(adminUrl!);
    await runMigrations({ adminUrl: temp.adminUrl, appRole: temp.role });
  });

  afterAll(async () => {
    await temp.drop();
  });

  it('issues a third-party root key by default, a local one on request, and nothing else', async () => {
    const root = seed();
    expect(root.status, root.stderr).toBe(0);
    expect(JSON.parse(root.stdout)).toMatchObject({ tenantId: 't1', trust: 'third-party' });
    const local = seed('--trust', 'local', '--key-name', 'hook');
    expect(local.status, local.stderr).toBe(0);
    expect(JSON.parse(local.stdout)).toMatchObject({ trust: 'local' });
    const bogus = seed('--trust', 'admin');
    expect(bogus.status).toBe(2);
    expect(bogus.stderr).toContain('--trust local|third-party');
    const client = postgres(temp.adminUrl, { max: 1, onnotice: () => undefined });
    const rows = await client.unsafe(`SELECT name, trust FROM api_keys ORDER BY created_at, id`);
    await client.end();
    expect(rows.map((row) => [String(row.name), String(row.trust)])).toEqual([
      ['seed', 'third-party'],
      ['hook', 'local'],
    ]);
  }, 60_000);
});
