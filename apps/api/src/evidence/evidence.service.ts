import { signBytes } from '@debrief/chain';
import { type BundleInput, type Proofs, packBundle, renderReport } from '@debrief/evidence';
import { SAMPLE_POLICIES, parsePolicy } from '@debrief/policy';
import { authorityLineage, blastRadius, divergence } from '@debrief/reconstruct';
import type { Checkpoint, Event } from '@debrief/schema';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';

import { BlobsService } from '../blobs/blobs.service.js';
import { CheckpointerService } from '../checkpoints/checkpointer.service.js';
import { CheckpointsRepository } from '../checkpoints/checkpoints.repository.js';
import { TreeCache } from '../checkpoints/tree-cache.js';
import { DB, type Db } from '../db/db.module.js';
import { evidenceJobs, narratives } from '../db/schema.js';
import { ulid } from '../ids/ulid.js';
import { eventsHash } from '../narration/narrative.js';
import { ReconstructionService } from '../reconstruction/reconstruction.service.js';
import { RunsService } from '../runs/runs.service.js';
import { SIGNING_KEY, type SigningKey } from '../signing/signing-key.js';
import { OBJECT_STORE, type ObjectStore } from '../storage/object-store.js';

export interface EvidenceOptions {
  includeContent: boolean;
  policyId: string;
}

export interface EvidenceJob {
  id: string;
  runId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  error?: string;
  createdAt: string;
  completedAt?: string;
  downloadUrl?: string;
  bytes?: number;
}

const DOWNLOAD_TTL_SECONDS = 15 * 60;

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

// ARCHITECTURE §12 and §13: POST creates the job and answers at once; the bundle is built in-process, stored, and served by URL.
@Injectable()
export class EvidenceService {
  private readonly building = new Map<string, Promise<void>>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(SIGNING_KEY) private readonly signingKey: SigningKey,
    private readonly reconstruction: ReconstructionService,
    private readonly runs: RunsService,
    private readonly checkpoints: CheckpointsRepository,
    private readonly checkpointer: CheckpointerService,
    private readonly trees: TreeCache,
    private readonly blobs: BlobsService,
    private readonly logger: Logger,
  ) {}

  async create(tenantId: string, runId: string, options: EvidenceOptions): Promise<EvidenceJob> {
    if (SAMPLE_POLICIES[options.policyId] === undefined) {
      throw new BadRequestException(
        `policyId is one of ${Object.keys(SAMPLE_POLICIES).join(', ')}`,
      );
    }
    if ((await this.runs.get(tenantId, runId)) === undefined) {
      throw new NotFoundException('run not found');
    }
    const id = ulid();
    const [row] = await this.db
      .insert(evidenceJobs)
      .values({ id, tenantId, runId, status: 'queued' })
      .returning();
    if (row === undefined) throw new ServiceUnavailableException('could not queue the job');
    const work = this.build(tenantId, runId, id, options).finally(() => {
      this.building.delete(id);
    });
    this.building.set(id, work);
    return { id, runId, status: 'queued', createdAt: row.createdAt };
  }

  // Tests and shutdown wait for the jobs in flight; the request that queued one never does.
  async settle(): Promise<void> {
    await Promise.all(this.building.values());
  }

  async get(tenantId: string, jobId: string): Promise<EvidenceJob> {
    const row = await this.row(tenantId, jobId);
    if (row === undefined) throw new NotFoundException('evidence job not found');
    const job: EvidenceJob = {
      id: row.id,
      runId: row.runId,
      status: row.status,
      createdAt: row.createdAt,
    };
    if (row.error !== null) job.error = row.error;
    if (row.completedAt !== null) job.completedAt = row.completedAt;
    if (row.status === 'done' && row.storageKey !== null) {
      job.downloadUrl =
        (await this.store.downloadUrl(row.storageKey, DOWNLOAD_TTL_SECONDS)) ??
        `/v1/evidence/${encodeURIComponent(row.id)}/bundle.zip`;
      const stored = await this.store.get(row.storageKey);
      if (stored !== undefined) job.bytes = stored.body.byteLength;
    }
    return job;
  }

  async bundle(tenantId: string, jobId: string): Promise<Uint8Array> {
    const row = await this.row(tenantId, jobId);
    if (row?.status !== 'done' || row.storageKey === null) {
      throw new NotFoundException('bundle not ready');
    }
    const stored = await this.store.get(row.storageKey);
    if (stored === undefined) throw new NotFoundException('bundle is missing from storage');
    return stored.body;
  }

  private async row(tenantId: string, jobId: string) {
    const [row] = await this.db
      .select()
      .from(evidenceJobs)
      .where(and(eq(evidenceJobs.tenantId, tenantId), eq(evidenceJobs.id, jobId)))
      .limit(1);
    return row;
  }

  private async build(
    tenantId: string,
    runId: string,
    jobId: string,
    options: EvidenceOptions,
  ): Promise<void> {
    await this.db.update(evidenceJobs).set({ status: 'running' }).where(eq(evidenceJobs.id, jobId));
    try {
      const bytes = await this.pack(tenantId, runId, options);
      const storageKey = `evidence/${tenantId}/${jobId}.zip`;
      await this.store.put(storageKey, bytes, 'application/zip');
      await this.db
        .update(evidenceJobs)
        .set({ status: 'done', storageKey, completedAt: new Date().toISOString() })
        .where(eq(evidenceJobs.id, jobId));
      this.logger.log({ tenantId, runId, jobId, bytes: bytes.byteLength }, 'evidence sealed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.db
        .update(evidenceJobs)
        .set({ status: 'failed', error: message, completedAt: new Date().toISOString() })
        .where(eq(evidenceJobs.id, jobId));
      this.logger.warn({ tenantId, runId, jobId, err: error }, 'evidence job failed');
    }
  }

  // Everything the bundle needs comes from what the API already computes; the model is never called here.
  private async pack(
    tenantId: string,
    runId: string,
    options: EvidenceOptions,
  ): Promise<Uint8Array> {
    const loaded = await this.reconstruction.load(tenantId, runId);
    const events = loaded.events.filter((event) => event.runId === runId);
    if (events.length === 0) throw new Error('the run has no events');
    const run = await this.runs.get(tenantId, runId);
    const { checkpoints, proofs } = await this.prove(tenantId, events);
    const policy = parsePolicy(SAMPLE_POLICIES[options.policyId] ?? '');
    const report = divergence(loaded.events, policy, loaded.graph);
    const origin = report.freezeFrame?.nodeId;
    const lineage =
      origin === undefined ? undefined : authorityLineage(loaded.graph, origin, loaded.events);
    const blast =
      origin === undefined ? undefined : blastRadius(loaded.graph, origin, loaded.events);
    const narrative = await this.cachedNarrative(tenantId, runId, events);
    const generatedAt = new Date().toISOString();
    const rendered = renderReport({
      run: {
        id: runId,
        tenantId,
        ...(run === undefined || run.agentName === '' ? {} : { agentName: run.agentName }),
        ...(run === undefined ? {} : { principalId: run.principalId }),
      },
      events,
      checkpoints,
      policyId: options.policyId,
      divergence: report,
      ...(lineage === undefined ? {} : { lineage }),
      ...(blast === undefined ? {} : { blast }),
      ...(narrative === undefined ? {} : { narrative }),
      includeContent: options.includeContent,
      generatedAt,
    });
    const { keypair } = this.signingKey;
    const input: BundleInput = {
      tenantId,
      runIds: [runId],
      events,
      checkpoints,
      proofs,
      keyId: keypair.keyId,
      publicKey: hex(keypair.publicKey),
      report: rendered.markdown,
      regulationMap: rendered.regulationMap,
      generatedAt,
      policy: { includeContent: options.includeContent },
    };
    if (options.includeContent) input.blobs = await this.sealedContent(tenantId, events);
    return packBundle(input, (digest) => signBytes(digest, keypair.secretKey));
  }

  // The latest checkpoint covering the run's last event proves every event; an earlier one covering the first adds a consistency proof.
  private async prove(
    tenantId: string,
    events: readonly Event[],
  ): Promise<{ checkpoints: Checkpoint[]; proofs: Proofs }> {
    const seqs = events.map((event) => event.seq);
    const last = Math.max(...seqs);
    const first = Math.min(...seqs);
    let latest = await this.checkpoints.latestCovering(tenantId, last);
    if (latest === undefined) {
      await this.checkpointer.checkpointTenant(tenantId);
      latest = await this.checkpoints.latestCovering(tenantId, last);
    }
    if (latest === undefined) throw new Error(`no checkpoint covers seq ${String(last)} yet`);
    const tree = await this.trees.treeFor(tenantId, latest.treeSize);
    const treeSize = latest.treeSize;
    const inclusion = events.map((event) => ({
      seq: event.seq,
      treeSize,
      proof: tree.inclusionProof(event.seq, treeSize),
    }));
    const earlier = await this.earliestCovering(tenantId, first, treeSize);
    const checkpoints = earlier === undefined ? [latest] : [earlier, latest];
    const consistency =
      earlier === undefined
        ? []
        : [
            {
              first: earlier.treeSize,
              second: treeSize,
              proof: tree.consistencyProof(earlier.treeSize, treeSize),
            },
          ];
    return { checkpoints, proofs: { inclusion, consistency } };
  }

  private async earliestCovering(
    tenantId: string,
    seq: number,
    below: number,
  ): Promise<Checkpoint | undefined> {
    const candidates = await this.checkpoints.list(tenantId, 100);
    return [...candidates]
      .filter((checkpoint) => checkpoint.treeSize > seq && checkpoint.treeSize < below)
      .sort((a, b) => a.treeSize - b.treeSize)[0];
  }

  private async cachedNarrative(
    tenantId: string,
    runId: string,
    events: readonly Event[],
  ): Promise<{ text: string; eventIds: string[] }[] | undefined> {
    const [row] = await this.db
      .select()
      .from(narratives)
      .where(
        and(
          eq(narratives.tenantId, tenantId),
          eq(narratives.runId, runId),
          eq(narratives.eventsHash, eventsHash(events)),
        ),
      )
      .orderBy(desc(narratives.createdAt))
      .limit(1);
    return row?.sentences;
  }

  private async sealedContent(
    tenantId: string,
    events: readonly Event[],
  ): Promise<Record<string, Uint8Array>> {
    const blobs: Record<string, Uint8Array> = {};
    for (const event of events) {
      const sha = event.payloadSha256;
      if (sha === undefined || sha in blobs) continue;
      const found = await this.blobs.get(tenantId, sha);
      if (found !== undefined) blobs[sha] = found.body;
    }
    return blobs;
  }
}
