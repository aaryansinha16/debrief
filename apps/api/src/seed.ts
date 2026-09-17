import { parseArgs } from 'node:util';

import { captureModeSchema } from '@debrief/schema';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { generateApiKey } from './auth/api-keys.js';
import { apiKeys, tenants } from './db/schema.js';
import { ulid } from './ids/ulid.js';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    tenant: { type: 'string' },
    name: { type: 'string' },
    capture: { type: 'string', default: 'on' },
    'key-name': { type: 'string', default: 'seed' },
  },
});

const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const capture = captureModeSchema.safeParse(values.capture);
if (url === undefined || values.tenant === undefined || !capture.success) {
  process.stderr.write(
    'usage: seed --tenant <id> [--name <name>] [--capture off|summary|on] [--key-name <name>]\n',
  );
  process.exit(2);
}

const client = postgres(url, { max: 1, onnotice: () => undefined });
const db = drizzle(client);
const key = generateApiKey();
try {
  await db
    .insert(tenants)
    .values({ id: values.tenant, name: values.name ?? values.tenant, captureMode: capture.data })
    .onConflictDoUpdate({ target: tenants.id, set: { captureMode: capture.data } });
  await db.execute(sql`select 1`);
  const keyId = ulid();
  await db.insert(apiKeys).values({
    id: keyId,
    tenantId: values.tenant,
    keyHash: key.keyHash,
    prefix: key.prefix,
    name: values['key-name'],
  });
  process.stdout.write(
    `${JSON.stringify({ tenantId: values.tenant, keyId, key: key.key, captureMode: capture.data })}\n`,
  );
} finally {
  await client.end();
}
