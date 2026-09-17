import type { Blob } from '@debrief/schema';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { CONFIG, type Config } from '../config/config.js';
import { DB, type Db } from '../db/db.module.js';
import { blobs } from '../db/schema.js';
import { OBJECT_STORE, type ObjectStore } from '../storage/object-store.js';
import { TenantKeysService, open, seal } from '../tenants/tenant-keys.service.js';

export class BlobTooLargeError extends Error {
  override readonly name = 'BlobTooLargeError';
}

export class BlobCorruptError extends Error {
  override readonly name = 'BlobCorruptError';
}

export const blobObjectKey = (tenantId: string, sha256Hex: string): string =>
  `blobs/${tenantId}/${sha256Hex}`;

function toBlob(row: typeof blobs.$inferSelect): Blob {
  const blob: Blob = {
    sha256: row.sha256,
    tenantId: row.tenantId,
    size: row.size,
    mime: row.mime,
    encrypted: row.encrypted,
    storageKey: row.storageKey,
    createdAt: row.createdAt,
  };
  if (row.keyId !== null) blob.keyId = row.keyId;
  return blob;
}

// Content-addressed by the plaintext sha256; stored sealed under the tenant data key (D-010).
@Injectable()
export class BlobsService {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: Db,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    private readonly keys: TenantKeysService,
  ) {}

  async put(tenantId: string, plaintext: Uint8Array, mime: string): Promise<Blob> {
    if (plaintext.length > this.config.BLOB_MAX_BYTES) {
      throw new BlobTooLargeError(
        `blob of ${String(plaintext.length)} bytes exceeds ${String(this.config.BLOB_MAX_BYTES)}`,
      );
    }
    const digest = bytesToHex(sha256(plaintext));
    const existing = await this.find(tenantId, digest);
    if (existing !== undefined) return existing;
    const key = await this.keys.keyFor(tenantId);
    const storageKey = blobObjectKey(tenantId, digest);
    await this.store.put(
      storageKey,
      seal(key.dataKey, plaintext, `blob:${tenantId}:${digest}`),
      'application/octet-stream',
    );
    const row: typeof blobs.$inferInsert = {
      tenantId,
      sha256: digest,
      size: plaintext.length,
      mime,
      encrypted: true,
      keyId: key.keyId,
      storageKey,
    };
    await this.db.insert(blobs).values(row).onConflictDoNothing();
    return (
      (await this.find(tenantId, digest)) ??
      toBlob({ ...row, keyId: key.keyId, createdAt: new Date().toISOString() })
    );
  }

  async find(tenantId: string, digest: string): Promise<Blob | undefined> {
    const [row] = await this.db
      .select()
      .from(blobs)
      .where(and(eq(blobs.tenantId, tenantId), eq(blobs.sha256, digest)))
      .limit(1);
    return row === undefined ? undefined : toBlob(row);
  }

  async get(
    tenantId: string,
    digest: string,
  ): Promise<{ blob: Blob; body: Uint8Array } | undefined> {
    const blob = await this.find(tenantId, digest);
    if (blob === undefined) return undefined;
    const key = await this.keys.keyFor(tenantId);
    const stored = await this.store.get(blob.storageKey);
    if (stored === undefined) throw new BlobCorruptError(`object ${blob.storageKey} is missing`);
    const body = open(key.dataKey, stored.body, `blob:${tenantId}:${digest}`);
    if (bytesToHex(sha256(body)) !== digest)
      throw new BlobCorruptError(`object ${blob.storageKey} does not match its digest`);
    return { blob, body };
  }
}
