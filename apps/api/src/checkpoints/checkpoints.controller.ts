import { verifyInclusion } from '@debrief/chain';
import type { Checkpoint, Event } from '@debrief/schema';
import { hexToBytes } from '@noble/hashes/utils.js';
import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';

import type { AuthenticatedRequest } from '../auth/api-key.guard.js';
import { Public } from '../auth/public.decorator.js';
import { EventsRepository } from '../events/events.repository.js';
import { SIGNING_KEY, type SigningKey } from '../signing/signing-key.js';
import { CheckpointsRepository } from './checkpoints.repository.js';
import { TreeCache } from './tree-cache.js';

const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

const proofQuerySchema = z
  .object({ event: z.string().min(1).optional(), seq: z.coerce.number().int().min(0).optional() })
  .refine((query) => (query.event === undefined) !== (query.seq === undefined), {
    message: 'pass exactly one of event or seq',
  });

export interface InclusionProofResponse {
  event: Pick<Event, 'id' | 'seq' | 'hash'>;
  checkpoint: Checkpoint;
  proof: string[];
}

@Controller()
export class CheckpointsController {
  constructor(
    @Inject(SIGNING_KEY) private readonly signingKey: SigningKey,
    private readonly checkpoints: CheckpointsRepository,
    private readonly events: EventsRepository,
    private readonly trees: TreeCache,
  ) {}

  // Public and read-only, so a verifier page on any origin (or file://) may fetch it (NFR-6).
  @Public()
  @Get('.well-known/debrief-keys.json')
  @Header('access-control-allow-origin', '*')
  @Header('cache-control', 'public, max-age=60')
  keys(): { keys: SigningKey['publicKeys'] } {
    return { keys: this.signingKey.publicKeys };
  }

  @Get('v1/checkpoints')
  async list(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
  ): Promise<{ checkpoints: Checkpoint[] }> {
    const parsed = listQuerySchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException('limit must be an integer between 1 and 100');
    return { checkpoints: await this.checkpoints.list(request.auth.tenantId, parsed.data.limit) };
  }

  @Get('v1/proof')
  async proof(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
  ): Promise<InclusionProofResponse> {
    const parsed = proofQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('pass exactly one of event=<id> or seq=<n>');
    const { tenantId } = request.auth;
    const event =
      parsed.data.event !== undefined
        ? await this.events.findById(tenantId, parsed.data.event)
        : await this.events.findBySeq(tenantId, parsed.data.seq ?? 0);
    if (event === undefined) throw new NotFoundException('event not found');
    const checkpoint = await this.checkpoints.latestCovering(tenantId, event.seq);
    if (checkpoint === undefined)
      throw new NotFoundException('no checkpoint covers this event yet');
    const tree = await this.trees.treeFor(tenantId, checkpoint.treeSize);
    const proof = tree.inclusionProof(event.seq, checkpoint.treeSize);
    if (
      !verifyInclusion(
        hexToBytes(event.hash),
        event.seq,
        checkpoint.treeSize,
        proof,
        checkpoint.rootHash,
      )
    ) {
      throw new Error(
        `stored events for ${tenantId} do not match checkpoint ${String(checkpoint.treeSize)}`,
      );
    }
    return { event: { id: event.id, seq: event.seq, hash: event.hash }, checkpoint, proof };
  }
}
