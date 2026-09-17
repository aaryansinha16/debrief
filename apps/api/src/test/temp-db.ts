import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';
import postgres from 'postgres';

export interface TempDatabase {
  name: string;
  role: string;
  adminUrl: string;
  appUrl: string;
  drop(): Promise<void>;
}

const withDatabase = (url: string, name: string, user?: string, password?: string): string => {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  if (user !== undefined) {
    parsed.username = user;
    parsed.password = password ?? '';
  }
  return parsed.toString();
};

export async function createTempDatabase(adminUrl: string): Promise<TempDatabase> {
  const suffix = bytesToHex(randomBytes(4));
  const name = `debrief_test_${suffix}`;
  const role = `debrief_test_${suffix}`;
  const password = bytesToHex(randomBytes(8));
  const maintenance = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  await maintenance.unsafe(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`);
  await maintenance.unsafe(`GRANT CONNECT ON DATABASE "${name}" TO "${role}"`);
  await maintenance.end();
  const scoped = postgres(withDatabase(adminUrl, name), { max: 1, onnotice: () => undefined });
  await scoped.unsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
  await scoped.end();
  return {
    name,
    role,
    adminUrl: withDatabase(adminUrl, name),
    appUrl: withDatabase(adminUrl, name, role, password),
    async drop() {
      const client = postgres(adminUrl, { max: 1, onnotice: () => undefined });
      await client.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await client.unsafe(`DROP ROLE IF EXISTS "${role}"`);
      await client.end();
    },
  };
}

export const adminUrlFromEnv = (): string | undefined => process.env.DATABASE_ADMIN_URL;
