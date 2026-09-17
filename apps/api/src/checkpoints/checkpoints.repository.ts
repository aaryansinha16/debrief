import type { Checkpoint } from '@debrief/schema';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt } from 'drizzle-orm';

import { DB, type Db } from '../db/db.module.js';
import { checkpoints } from '../db/schema.js';

type CheckpointRow = typeof checkpoints.$inferSelect;

export function toCheckpoint(row: CheckpointRow): Checkpoint {
  const checkpoint: Checkpoint = {
    tenantId: row.tenantId,
    treeSize: row.treeSize,
    rootHash: row.rootHash,
    headHash: row.headHash,
    ts: row.ts,
    keyId: row.keyId,
    signature: row.signature,
  };
  if (row.anchor !== null) checkpoint.anchor = row.anchor;
  return checkpoint;
}

@Injectable()
export class CheckpointsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async insert(checkpoint: Checkpoint): Promise<boolean> {
    const inserted = await this.db
      .insert(checkpoints)
      .values(checkpoint)
      .onConflictDoNothing()
      .returning({ treeSize: checkpoints.treeSize });
    return inserted.length > 0;
  }

  async latest(tenantId: string): Promise<Checkpoint | undefined> {
    const [row] = await this.db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.tenantId, tenantId))
      .orderBy(desc(checkpoints.treeSize))
      .limit(1);
    return row === undefined ? undefined : toCheckpoint(row);
  }

  async latestCovering(tenantId: string, seq: number): Promise<Checkpoint | undefined> {
    const [row] = await this.db
      .select()
      .from(checkpoints)
      .where(and(eq(checkpoints.tenantId, tenantId), gt(checkpoints.treeSize, seq)))
      .orderBy(desc(checkpoints.treeSize))
      .limit(1);
    return row === undefined ? undefined : toCheckpoint(row);
  }

  async list(tenantId: string, limit: number): Promise<Checkpoint[]> {
    const rows = await this.db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.tenantId, tenantId))
      .orderBy(desc(checkpoints.treeSize))
      .limit(limit);
    return rows.map(toCheckpoint);
  }
}
