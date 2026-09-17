import { MerkleTree } from '@debrief/chain';
import { hexToBytes } from '@noble/hashes/utils.js';
import { Injectable } from '@nestjs/common';

import { EventsRepository } from '../events/events.repository.js';

// One append-only merkle tree per tenant, extended from the events table on demand (D-023).
@Injectable()
export class TreeCache {
  private readonly trees = new Map<string, MerkleTree>();
  private readonly pending = new Map<string, Promise<MerkleTree>>();

  constructor(private readonly events: EventsRepository) {}

  async treeFor(tenantId: string, size: number): Promise<MerkleTree> {
    const previous = this.pending.get(tenantId) ?? Promise.resolve(this.tree(tenantId));
    const next = previous.then(async (tree) => {
      if (tree.size < size) await this.extend(tenantId, tree, size);
      return tree;
    });
    this.pending.set(
      tenantId,
      next.catch(() => this.tree(tenantId)),
    );
    return next;
  }

  private tree(tenantId: string): MerkleTree {
    const existing = this.trees.get(tenantId);
    if (existing !== undefined) return existing;
    const created = new MerkleTree();
    this.trees.set(tenantId, created);
    return created;
  }

  private async extend(tenantId: string, tree: MerkleTree, size: number): Promise<void> {
    for await (const event of this.events.scan(tenantId, 1000, tree.size)) {
      if (event.seq !== tree.size)
        throw new Error(`events for ${tenantId} have a gap at seq ${String(tree.size)}`);
      tree.append(hexToBytes(event.hash));
      if (tree.size >= size) return;
    }
  }
}
