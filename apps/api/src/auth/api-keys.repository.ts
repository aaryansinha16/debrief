import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { DB, type Db } from '../db/db.module.js';
import { apiKeys, tenants } from '../db/schema.js';

export interface ResolvedKey {
  keyId: string;
  tenantId: string;
  captureMode: 'off' | 'summary' | 'on';
}

export interface ApiKeyResolver {
  resolve(keyHash: string): Promise<ResolvedKey | undefined>;
}

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
}
