import { checkpointSchema, eventSchema } from '@debrief/schema';
import { hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';

import chain from '../__golden__/chain-vectors.json';
import golden from '../__golden__/checkpoint-vectors.json';
import { generateKeypair, publicKeyEntry, signCheckpoint, verifyCheckpoint } from './checkpoint.js';
import { MerkleTree } from './merkle.js';

const events = eventSchema.array().parse(chain.events);
const checkpoint = checkpointSchema.parse(golden.checkpoint);

describe('checkpoint golden vector', () => {
  it('commits to the merkle root and head of the chain golden', () => {
    const tree = new MerkleTree();
    for (const event of events) tree.append(hexToBytes(event.hash));
    expect(checkpoint.treeSize).toBe(events.length);
    expect(checkpoint.rootHash).toBe(tree.root());
    expect(checkpoint.headHash).toBe(events[events.length - 1]!.hash);
  });

  it('is reproduced by signing with the pinned seed', () => {
    const keypair = generateKeypair(hexToBytes(golden.seed));
    const { signature: _signature, keyId: _keyId, ...unsigned } = checkpoint;
    expect(signCheckpoint(unsigned, keypair.secretKey)).toEqual(checkpoint);
    expect(publicKeyEntry(keypair.publicKey)).toEqual(golden.publicKey);
  });

  it('verifies against the pinned public key and fails against another', () => {
    expect(verifyCheckpoint(checkpoint, [golden.publicKey])).toEqual({
      ok: true,
      keyId: golden.publicKey.keyId,
    });
    expect(verifyCheckpoint(checkpoint, [publicKeyEntry(generateKeypair().publicKey)])).toEqual({
      ok: false,
      reason: 'unknown-key',
    });
  });
});
