import { hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';

import golden from '../__golden__/merkle-vectors.json';
import { MerkleTree, verifyConsistency, verifyInclusion } from './merkle.js';

const leaves = golden.leaves.map(hexToBytes);
const tree = new MerkleTree();
for (const data of leaves) tree.append(data);

describe('merkle golden vectors', () => {
  it('reproduces the root of every prefix', () => {
    expect(golden.roots).toHaveLength(leaves.length + 1);
    golden.roots.forEach((root, n) => {
      expect(tree.rootAt(n)).toBe(root);
    });
  });

  it('reproduces and verifies every inclusion proof', () => {
    expect(golden.inclusion).toHaveLength((leaves.length * (leaves.length + 1)) / 2);
    for (const { index, size, proof } of golden.inclusion) {
      expect(tree.inclusionProof(index, size)).toEqual(proof);
      expect(verifyInclusion(leaves[index]!, index, size, proof, golden.roots[size]!)).toBe(true);
    }
  });

  it('reproduces and verifies every consistency proof', () => {
    expect(golden.consistency).toHaveLength((leaves.length * (leaves.length + 1)) / 2);
    for (const { first, second, proof } of golden.consistency) {
      expect(tree.consistencyProof(first, second)).toEqual(proof);
      expect(
        verifyConsistency(first, second, golden.roots[first]!, golden.roots[second]!, proof),
      ).toBe(true);
    }
  });
});
