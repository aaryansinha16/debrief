import { type Anchorer, anchorDigest, deriveKeyId, signCheckpoint } from '@debrief/chain';
import type { Checkpoint } from '@debrief/schema';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { CONFIG, type Config } from '../config/config.js';
import { EventsRepository } from '../events/events.repository.js';
import { SIGNING_KEY, type SigningKey } from '../signing/signing-key.js';
import { OBJECT_STORE, type ObjectStore } from '../storage/object-store.js';
import { CheckpointsRepository } from './checkpoints.repository.js';
import { ANCHORER } from './anchorer.js';
import { TreeCache } from './tree-cache.js';

export const checkpointObjectKey = (
  checkpoint: Pick<Checkpoint, 'tenantId' | 'treeSize'>,
): string =>
  `checkpoints/${checkpoint.tenantId}/${String(checkpoint.treeSize).padStart(16, '0')}.json`;

interface TenantState {
  lastSeenSeq: number;
  lastCheckpointAt: number;
}

// Runs off the ingest path: appends only report their head seq; checkpoints are cut here (ARCHITECTURE §6.3).
@Injectable()
export class CheckpointerService implements OnModuleInit, OnModuleDestroy {
  private readonly tenants = new Map<string, TenantState>();
  private readonly unmirrored = new Map<string, Checkpoint>();
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> = Promise.resolve();

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(SIGNING_KEY) private readonly signingKey: SigningKey,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(ANCHORER) private readonly anchorer: Anchorer,
    private readonly events: EventsRepository,
    private readonly checkpoints: CheckpointsRepository,
    private readonly trees: TreeCache,
    private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.runDue(), this.config.CHECKPOINT_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  observe(tenantId: string, headSeq: number): void {
    const state = this.tenants.get(tenantId) ?? { lastSeenSeq: -1, lastCheckpointAt: 0 };
    state.lastSeenSeq = Math.max(state.lastSeenSeq, headSeq);
    this.tenants.set(tenantId, state);
  }

  async runDue(now = Date.now()): Promise<Checkpoint[]> {
    const cut: Checkpoint[] = [];
    await this.serialized(async () => {
      for (const [tenantId, state] of this.tenants) {
        const latest = await this.checkpoints.latest(tenantId);
        const covered = latest?.treeSize ?? 0;
        const pending = state.lastSeenSeq + 1 - covered;
        const overdue = now - state.lastCheckpointAt >= this.config.CHECKPOINT_INTERVAL_MS;
        if (pending <= 0 || (pending < this.config.CHECKPOINT_EVERY_EVENTS && !overdue)) continue;
        const checkpoint = await this.cut(tenantId, now);
        if (checkpoint !== undefined) cut.push(checkpoint);
      }
      await this.mirrorPending();
    });
    return cut;
  }

  async checkpointTenant(tenantId: string, now = Date.now()): Promise<Checkpoint | undefined> {
    let result: Checkpoint | undefined;
    await this.serialized(async () => {
      result = await this.cut(tenantId, now);
      await this.mirrorPending();
    });
    return result;
  }

  // A witness that cannot be reached must not stop the checkpoint: the chain is the integrity, the anchor is the extra.
  private async anchor(
    unsigned: Omit<Checkpoint, 'signature' | 'keyId' | 'anchor'>,
  ): Promise<Checkpoint['anchor']> {
    if (this.anchorer.kind === 'none') return undefined;
    const keyId = deriveKeyId(this.signingKey.keypair.publicKey);
    try {
      return await this.anchorer.anchor({
        digest: anchorDigest({ ...unsigned, keyId }),
        tenantId: unsigned.tenantId,
        treeSize: unsigned.treeSize,
      });
    } catch (error) {
      this.logger.warn(
        { tenantId: unsigned.tenantId, treeSize: unsigned.treeSize, err: error },
        'checkpoint cut without its anchor',
      );
      return undefined;
    }
  }

  private serialized(work: () => Promise<void>): Promise<void> {
    const next = this.running.then(work, work);
    this.running = next.catch((error: unknown) => {
      this.logger.error({ err: error }, 'checkpointer run failed');
    });
    return next;
  }

  private async cut(tenantId: string, now: number): Promise<Checkpoint | undefined> {
    const head = await this.events.head(tenantId);
    if (head === undefined) return undefined;
    const treeSize = head.seq + 1;
    const latest = await this.checkpoints.latest(tenantId);
    if (latest !== undefined && latest.treeSize >= treeSize) return undefined;
    const tree = await this.trees.treeFor(tenantId, treeSize);
    const unsigned = {
      tenantId,
      treeSize,
      rootHash: tree.rootAt(treeSize),
      headHash: head.hash,
      ts: new Date(now).toISOString(),
    };
    const anchor = await this.anchor(unsigned);
    const checkpoint = signCheckpoint(
      { ...unsigned, ...(anchor === undefined ? {} : { anchor }) },
      this.signingKey.keypair.secretKey,
    );
    const inserted = await this.checkpoints.insert(checkpoint);
    if (!inserted) return undefined;
    const state = this.tenants.get(tenantId) ?? { lastSeenSeq: head.seq, lastCheckpointAt: 0 };
    state.lastCheckpointAt = now;
    this.tenants.set(tenantId, state);
    this.unmirrored.set(checkpointObjectKey(checkpoint), checkpoint);
    this.logger.log({ tenantId, treeSize, keyId: checkpoint.keyId }, 'checkpoint cut');
    return checkpoint;
  }

  private async mirrorPending(): Promise<void> {
    for (const [key, checkpoint] of this.unmirrored) {
      try {
        await this.store.put(
          key,
          new TextEncoder().encode(JSON.stringify(checkpoint)),
          'application/json',
        );
        this.unmirrored.delete(key);
      } catch (error) {
        this.logger.warn({ err: error, key }, 'checkpoint mirror failed; will retry');
      }
    }
  }

  unmirroredCount(): number {
    return this.unmirrored.size;
  }
}
