import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

export interface MigrateOptions {
  adminUrl: string;
  appRole: string;
  migrationsFolder?: string;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export const defaultMigrationsFolder = new URL('../../drizzle', import.meta.url).pathname;

export async function runMigrations(options: MigrateOptions): Promise<void> {
  if (!IDENTIFIER.test(options.appRole)) {
    throw new Error(`invalid app role name: ${JSON.stringify(options.appRole)}`);
  }
  const client = postgres(options.adminUrl, { max: 1, onnotice: () => undefined });
  try {
    const db = drizzle(client);
    await db.execute(sql.raw(`SET debrief.app_role = '${options.appRole}'`));
    await migrate(db, { migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder });
  } finally {
    await client.end();
  }
}
