import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ChainError } from './errors.js';
import {
  EMPTY_ROOT,
  MerkleTree,
  leafHash,
  nodeHash,
  verifyConsistency,
  verifyInclusion,
} from './merkle.js';

const leaf = (i: number): Uint8Array => utf8ToBytes(`leaf-${String(i)}`);

function build(n: number, at: (i: number) => Uint8Array = leaf): MerkleTree {
  const tree = new MerkleTree();
  for (let i = 0; i < n; i += 1) tree.append(at(i));
  return tree;
}

function referenceRoot(leaves: readonly Uint8Array[]): Uint8Array {
  if (leaves.length === 0) return sha256(new Uint8Array(0));
  if (leaves.length === 1) return leafHash(leaves[0]!);
  let k = 1;
  while (k * 2 < leaves.length) k *= 2;
  return nodeHash(referenceRoot(leaves.slice(0, k)), referenceRoot(leaves.slice(k)));
}

const flipHexBit = (hex: string, bit: number): string => {
  const bytes = hexToBytes(hex);
  bytes[bit >> 3]! ^= 1 << (bit & 7);
  return bytesToHex(bytes);
};

const flipDataBit = (data: Uint8Array, bit: number): Uint8Array => {
  const copy = Uint8Array.from(data);
  copy[bit >> 3]! ^= 1 << (bit & 7);
  return copy;
};

const log2ceil = (n: number): number => Math.ceil(Math.log2(n));

describe('hashing', () => {
  it('prefixes leaves with 0x00 and nodes with 0x01', () => {
    const a = utf8ToBytes('a');
    const b = utf8ToBytes('b');
    expect(leafHash(a)).toEqual(sha256(concatBytes(Uint8Array.of(0), a)));
    expect(nodeHash(a, b)).toEqual(sha256(concatBytes(Uint8Array.of(1), a, b)));
    expect(EMPTY_ROOT).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('separates the leaf and node domains', () => {
    const a = utf8ToBytes('a');
    const b = utf8ToBytes('b');
    expect(bytesToHex(leafHash(concatBytes(a, b)))).not.toBe(bytesToHex(nodeHash(a, b)));
  });
});

describe('MerkleTree', () => {
  it('starts empty with the empty root', () => {
    const tree = new MerkleTree();
    expect(tree.size).toBe(0);
    expect(tree.root()).toBe(EMPTY_ROOT);
    expect(tree.rootAt(0)).toBe(EMPTY_ROOT);
  });

  it('returns the index on append and hashes a single leaf as a leaf', () => {
    const tree = new MerkleTree();
    expect(tree.append(leaf(0))).toBe(0);
    expect(tree.append(leaf(1))).toBe(1);
    expect(build(1).root()).toBe(bytesToHex(leafHash(leaf(0))));
  });

  it('matches the recursive RFC 6962 definition for every size up to 64', () => {
    const tree = build(64);
    const leaves = Array.from({ length: 64 }, (_, i) => leaf(i));
    for (let n = 0; n <= 64; n += 1) {
      expect(tree.rootAt(n)).toBe(bytesToHex(referenceRoot(leaves.slice(0, n))));
      expect(build(n).root()).toBe(tree.rootAt(n));
    }
  });

  it.each([
    ['rootAt', (t: MerkleTree) => t.rootAt(9)],
    ['rootAt', (t: MerkleTree) => t.rootAt(-1)],
    ['rootAt', (t: MerkleTree) => t.rootAt(1.5)],
    ['inclusionProof', (t: MerkleTree) => t.inclusionProof(8)],
    ['inclusionProof', (t: MerkleTree) => t.inclusionProof(-1)],
    ['inclusionProof', (t: MerkleTree) => t.inclusionProof(0.5)],
    ['inclusionProof', (t: MerkleTree) => t.inclusionProof(3, 3)],
    ['inclusionProof', (t: MerkleTree) => t.inclusionProof(0, 9)],
    ['consistencyProof', (t: MerkleTree) => t.consistencyProof(0)],
    ['consistencyProof', (t: MerkleTree) => t.consistencyProof(9)],
    ['consistencyProof', (t: MerkleTree) => t.consistencyProof(5, 4)],
    ['consistencyProof', (t: MerkleTree) => t.consistencyProof(1, 9)],
    ['consistencyProof', (t: MerkleTree) => t.consistencyProof(1.5, 4)],
  ])('%s rejects out-of-range arguments', (_name, call) => {
    expect(() => call(build(8))).toThrow(ChainError);
  });

  it('produces verifying, logarithmic inclusion proofs for every leaf of every size up to 64', () => {
    const tree = build(64);
    for (let n = 1; n <= 64; n += 1) {
      const root = tree.rootAt(n);
      for (let i = 0; i < n; i += 1) {
        const proof = tree.inclusionProof(i, n);
        expect(proof.length).toBeLessThanOrEqual(log2ceil(n));
        expect(verifyInclusion(leaf(i), i, n, proof, root)).toBe(true);
      }
    }
  });

  it('produces verifying, logarithmic consistency proofs for every 1 <= m <= n <= 64', () => {
    const tree = build(64);
    for (let n = 1; n <= 64; n += 1) {
      for (let m = 1; m <= n; m += 1) {
        const proof = tree.consistencyProof(m, n);
        expect(proof.length).toBeLessThanOrEqual(log2ceil(n) + 1);
        expect(verifyConsistency(m, n, tree.rootAt(m), tree.rootAt(n), proof)).toBe(true);
      }
    }
  });

  it('defaults proofs to the current size', () => {
    const tree = build(13);
    expect(tree.inclusionProof(4)).toEqual(tree.inclusionProof(4, 13));
    expect(tree.consistencyProof(5)).toEqual(tree.consistencyProof(5, 13));
  });
});

describe('verifyInclusion', () => {
  const tree = build(11);
  const root = tree.root();
  const proof = tree.inclusionProof(6);

  it('accepts the genuine proof, and any size that yields the same path shape', () => {
    expect(verifyInclusion(leaf(6), 6, 11, proof, root)).toBe(true);
    expect(verifyInclusion(leaf(6), 6, 16, proof, root)).toBe(true);
  });

  it.each([
    ['wrong leaf', () => verifyInclusion(leaf(7), 6, 11, proof, root)],
    ['wrong index', () => verifyInclusion(leaf(6), 5, 11, proof, root)],
    ['index at size', () => verifyInclusion(leaf(6), 11, 11, proof, root)],
    ['negative index', () => verifyInclusion(leaf(6), -1, 11, proof, root)],
    ['fractional index', () => verifyInclusion(leaf(6), 6.5, 11, proof, root)],
    ['a size with a shorter path', () => verifyInclusion(leaf(6), 6, 7, proof, root)],
    ['a size with a longer path', () => verifyInclusion(leaf(6), 6, 20, proof, root)],
    ['wrong root', () => verifyInclusion(leaf(6), 6, 11, proof, EMPTY_ROOT)],
    ['truncated proof', () => verifyInclusion(leaf(6), 6, 11, proof.slice(1), root)],
    ['extended proof', () => verifyInclusion(leaf(6), 6, 11, [...proof, root], root)],
    [
      'single-leaf tree with a proof',
      () => verifyInclusion(leaf(0), 0, 1, [root], build(1).root()),
    ],
  ])('rejects %s', (_label, run) => {
    expect(run()).toBe(false);
  });
});

describe('verifyConsistency', () => {
  const tree = build(13);

  it('accepts genuine proofs from power-of-two and other first sizes', () => {
    for (const m of [1, 4, 5, 8, 13]) {
      expect(
        verifyConsistency(m, 13, tree.rootAt(m), tree.rootAt(13), tree.consistencyProof(m, 13)),
      ).toBe(true);
    }
  });

  it.each([
    ['first of zero', () => verifyConsistency(0, 13, EMPTY_ROOT, tree.root(), [])],
    ['first above second', () => verifyConsistency(14, 13, tree.root(), tree.root(), [])],
    ['fractional first', () => verifyConsistency(1.5, 13, tree.root(), tree.root(), [])],
    ['equal sizes, different roots', () => verifyConsistency(13, 13, EMPTY_ROOT, tree.root(), [])],
    [
      'equal sizes, non-empty proof',
      () => verifyConsistency(13, 13, tree.root(), tree.root(), [tree.root()]),
    ],
    ['empty proof', () => verifyConsistency(5, 13, tree.rootAt(5), tree.root(), [])],
    [
      'wrong first root',
      () => verifyConsistency(5, 13, tree.rootAt(6), tree.root(), tree.consistencyProof(5, 13)),
    ],
    [
      'wrong second root',
      () => verifyConsistency(5, 13, tree.rootAt(5), tree.rootAt(12), tree.consistencyProof(5, 13)),
    ],
    [
      'truncated proof',
      () =>
        verifyConsistency(
          5,
          13,
          tree.rootAt(5),
          tree.root(),
          tree.consistencyProof(5, 13).slice(1),
        ),
    ],
    [
      'extended proof',
      () =>
        verifyConsistency(5, 13, tree.rootAt(5), tree.root(), [
          ...tree.consistencyProof(5, 13),
          tree.root(),
        ]),
    ],
    [
      'proof for a different first size',
      () => verifyConsistency(5, 13, tree.rootAt(5), tree.root(), tree.consistencyProof(4, 13)),
    ],
  ])('rejects %s', (_label, run) => {
    expect(run()).toBe(false);
  });
});

describe('properties', () => {
  const seededLeaf = (seed: number) => (i: number) =>
    sha256(utf8ToBytes(`${String(seed)}:${String(i)}`));

  it('random trees up to 5,000 leaves verify inclusion and consistency with O(log n) proofs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        fc.nat(),
        fc.nat(),
        fc.nat(),
        (n, seed, pick, pickM) => {
          const at = seededLeaf(seed);
          const tree = build(n, at);
          const root = tree.root();
          for (const i of [0, n - 1, pick % n]) {
            const proof = tree.inclusionProof(i);
            expect(proof.length).toBeLessThanOrEqual(log2ceil(n));
            expect(verifyInclusion(at(i), i, n, proof, root)).toBe(true);
          }
          const m = 1 + (pickM % n);
          const proof = tree.consistencyProof(m);
          expect(proof.length).toBeLessThanOrEqual(log2ceil(n) + 1);
          expect(verifyConsistency(m, n, tree.rootAt(m), root, proof)).toBe(true);
        },
      ),
      { numRuns: 25 },
    );
  });

  it('any single bit flip in the leaf, a proof element, or the root fails inclusion', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 512 }),
        fc.nat(),
        fc.nat(),
        fc.nat(),
        fc.nat({ max: 255 }),
        (n, seed, pick, which, bit) => {
          const at = seededLeaf(seed);
          const tree = build(n, at);
          const root = tree.root();
          const i = pick % n;
          const proof = tree.inclusionProof(i);
          expect(verifyInclusion(flipDataBit(at(i), bit), i, n, proof, root)).toBe(false);
          expect(verifyInclusion(at(i), i, n, proof, flipHexBit(root, bit))).toBe(false);
          if (proof.length > 0) {
            const k = which % proof.length;
            const tampered = proof.map((p, j) => (j === k ? flipHexBit(p, bit) : p));
            expect(verifyInclusion(at(i), i, n, tampered, root)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('any single bit flip in a consistency proof element or either root fails', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 512 }),
        fc.nat(),
        fc.nat(),
        fc.nat(),
        fc.nat({ max: 255 }),
        (n, seed, pickM, which, bit) => {
          const tree = build(n, seededLeaf(seed));
          const m = 1 + (pickM % (n - 1));
          const oldRoot = tree.rootAt(m);
          const newRoot = tree.root();
          const proof = tree.consistencyProof(m);
          expect(verifyConsistency(m, n, flipHexBit(oldRoot, bit), newRoot, proof)).toBe(false);
          expect(verifyConsistency(m, n, oldRoot, flipHexBit(newRoot, bit), proof)).toBe(false);
          const k = which % proof.length;
          const tampered = proof.map((p, j) => (j === k ? flipHexBit(p, bit) : p));
          expect(verifyConsistency(m, n, oldRoot, newRoot, tampered)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
