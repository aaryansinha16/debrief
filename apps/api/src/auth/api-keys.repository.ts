import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { DB, type Db } from '../db/db.module.js';
import { apiKeys, tenants } from '../db/schema.js';
import { ulid } from '../ids/ulid.js';
import { generateApiKey } from './api-keys.js';

export interface ResolvedKey {
  keyId: string;
  tenantId: string;
  captureMode: 'off' | 'summary' | 'on';
}

export interface ApiKeyResolver {
  resolve(keyHash: string): Promise<ResolvedKey | undefined>;
}

export interface ApiKeySummary {
  id: string;
  prefix: string;
  name: string;
  createdAt: string;
  revokedAt: string | null;
}

// The secret is returned once, on creation or rotation, and never stored or logged.
export interface IssuedApiKey extends ApiKeySummary {
  key: string;
}

export type RevokeOutcome = 'revoked' | 'not-found' | 'last-active';

@Injectable()
export class ApiKeysRepository implements ApiKeyResolver {
  constructor(@Inject(DB) private readonly db: Db) {}

  async resolve(keyHash: string): Promise<ResolvedKey | undefined> {
    const [row] = await this.db
      .select({ keyId: apiKeys.id, tenantId: apiKeys.tenantId, captureMode: tenants.captureMode })
      .from(apiKeys)
      .innerJoin(tenants, eq(tenants.id, apiKeys.tenantId))
      .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
      .limit(1);
    return row;
  }

  list(tenantId: string): Promise<ApiKeySummary[]> {
    return this.db
      .select(summaryColumns)
      .from(apiKeys)
      .where(eq(apiKeys.tenantId, tenantId))
      .orderBy(asc(apiKeys.createdAt), asc(apiKeys.id));
  }

  async create(tenantId: string, name: string): Promise<IssuedApiKey> {
    return this.db.transaction((tx) => issue(tx, tenantId, name));
  }

  // The old key stops resolving in the same transaction that issues the new one: no window where both, or neither, work.
  async rotate(tenantId: string, keyId: string): Promise<IssuedApiKey | undefined> {
    return this.db.transaction(async (tx) => {
      const [old] = await tx
        .update(apiKeys)
        .set({ revokedAt: sql`now()` })
        .where(active(tenantId, keyId))
        .returning({ name: apiKeys.name });
      return old === undefined ? undefined : issue(tx, tenantId, old.name);
    });
  }

  async revoke(tenantId: string, keyId: string): Promise<RevokeOutcome> {
    return this.db.transaction(async (tx) => {
      const [counted] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(apiKeys)
        .where(and(eq(apiKeys.tenantId, tenantId), isNull(apiKeys.revokedAt)));
      const [target] = await tx
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(active(tenantId, keyId));
      if (target === undefined) return 'not-found';
      if ((counted?.count ?? 0) <= 1) return 'last-active';
      await tx
        .update(apiKeys)
        .set({ revokedAt: sql`now()` })
        .where(active(tenantId, keyId));
      return 'revoked';
    });
  }
}

const summaryColumns = {
  id: apiKeys.id,
  prefix: apiKeys.prefix,
  name: apiKeys.name,
  createdAt: apiKeys.createdAt,
  revokedAt: apiKeys.revokedAt,
};

const active = (tenantId: string, keyId: string) =>
  and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.id, keyId), isNull(apiKeys.revokedAt));

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function issue(tx: Tx, tenantId: string, name: string): Promise<IssuedApiKey> {
  const generated = generateApiKey();
  const [row] = await tx
    .insert(apiKeys)
    .values({
      id: ulid(),
      tenantId,
      keyHash: generated.keyHash,
      prefix: generated.prefix,
      name,
    })
    .returning(summaryColumns);
  if (row === undefined) throw new Error('api key insert returned no row');
  return { ...row, key: generated.key };
}
