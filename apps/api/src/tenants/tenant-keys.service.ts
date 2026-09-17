import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { deriveKeyId } from '@debrief/chain';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { CONFIG, type Config } from '../config/config.js';
import { DB, type Db } from '../db/db.module.js';
import { tenantKeys } from '../db/schema.js';

export class TenantKeyDestroyedError extends Error {
  override readonly name = 'TenantKeyDestroyedError';
}

export interface TenantKey {
  keyId: string;
  dataKey: Uint8Array;
  piiSalt: string;
}

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

// AES-256-GCM: nonce ‖ ciphertext ‖ tag, with the caller's aad bound into the tag.
export function seal(key: Uint8Array, plaintext: Uint8Array, aad: string): Uint8Array {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}

export function open(key: Uint8Array, sealed: Uint8Array, aad: string): Uint8Array {
  if (sealed.length < NONCE_BYTES + TAG_BYTES) throw new Error('sealed payload too short');
  const nonce = sealed.subarray(0, NONCE_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const body = sealed.subarray(NONCE_BYTES, sealed.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

@Injectable()
export class TenantKeysService {
  private readonly masterKey: Uint8Array;
  private readonly cache = new Map<string, TenantKey | 'destroyed'>();

  constructor(
    @Inject(CONFIG) config: Config,
    @Inject(DB) private readonly db: Db,
  ) {
    this.masterKey = hexToBytes(config.BLOB_MASTER_KEY);
  }

  async saltFor(tenantId: string): Promise<string> {
    const row = await this.row(tenantId);
    return row.piiSalt;
  }

  async keyFor(tenantId: string): Promise<TenantKey> {
    const cached = this.cache.get(tenantId);
    if (cached === 'destroyed')
      throw new TenantKeyDestroyedError(`data key for ${tenantId} was destroyed`);
    if (cached !== undefined) return cached;
    const row = await this.row(tenantId);
    if (row.wrappedKey === null) {
      this.cache.set(tenantId, 'destroyed');
      throw new TenantKeyDestroyedError(`data key for ${tenantId} was destroyed`);
    }
    const key: TenantKey = {
      keyId: row.keyId,
      dataKey: open(this.masterKey, hexToBytes(row.wrappedKey), `dek:${tenantId}:${row.keyId}`),
      piiSalt: row.piiSalt,
    };
    this.cache.set(tenantId, key);
    return key;
  }

  async destroy(tenantId: string): Promise<void> {
    await this.db
      .update(tenantKeys)
      .set({ wrappedKey: null, destroyedAt: new Date().toISOString() })
      .where(eq(tenantKeys.tenantId, tenantId));
    this.cache.set(tenantId, 'destroyed');
  }

  private async row(tenantId: string): Promise<typeof tenantKeys.$inferSelect> {
    const [existing] = await this.db
      .select()
      .from(tenantKeys)
      .where(eq(tenantKeys.tenantId, tenantId))
      .limit(1);
    if (existing !== undefined) return existing;
    const dataKey = randomBytes(32);
    const keyId = deriveKeyId(dataKey);
    const fresh: typeof tenantKeys.$inferInsert = {
      tenantId,
      keyId,
      wrappedKey: bytesToHex(seal(this.masterKey, dataKey, `dek:${tenantId}:${keyId}`)),
      piiSalt: bytesToHex(randomBytes(16)),
    };
    await this.db.insert(tenantKeys).values(fresh).onConflictDoNothing();
    const [row] = await this.db
      .select()
      .from(tenantKeys)
      .where(eq(tenantKeys.tenantId, tenantId))
      .limit(1);
    if (row === undefined) throw new Error(`tenant_keys row for ${tenantId} vanished`);
    return row;
  }
}
