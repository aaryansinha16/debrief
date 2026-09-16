import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils.js';

import { ChainError } from './errors.js';

const LEAF_PREFIX = Uint8Array.of(0x00);
const NODE_PREFIX = Uint8Array.of(0x01);

// RFC 6962 §2.1
export function leafHash(data: Uint8Array): Uint8Array {
  return sha256(concatBytes(LEAF_PREFIX, data));
}

export function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concatBytes(NODE_PREFIX, left, right));
}

export const EMPTY_ROOT = bytesToHex(sha256(new Uint8Array(0)));

function largestPowerOfTwoBelow(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

function isOdd(n: number): boolean {
  return n % 2 === 1;
}

function halve(n: number): number {
  return Math.floor(n / 2);
}

export class MerkleTree {
  private readonly levels: Uint8Array[][] = [];
  private leafCount = 0;

  get size(): number {
    return this.leafCount;
  }

  append(data: Uint8Array): number {
    let node = leafHash(data);
    let level = 0;
    for (;;) {
      const row = this.row(level);
      const sibling = row[row.length - 1];
      row.push(node);
      if (sibling === undefined || isOdd(row.length)) break;
      node = nodeHash(sibling, node);
      level += 1;
    }
    this.leafCount += 1;
    return this.leafCount - 1;
  }

  root(): string {
    return this.rootAt(this.size);
  }

  rootAt(size: number): string {
    this.assertSize(size);
    if (size === 0) return EMPTY_ROOT;
    return bytesToHex(this.hashRange(0, size));
  }

  inclusionProof(index: number, size = this.size): string[] {
    this.assertSize(size);
    if (!Number.isInteger(index) || index < 0 || index >= size) {
      throw new ChainError(`leaf index ${String(index)} is outside a tree of size ${String(size)}`);
    }
    return this.path(0, size, index).map(bytesToHex);
  }

  consistencyProof(first: number, second = this.size): string[] {
    this.assertSize(second);
    if (!Number.isInteger(first) || first < 1 || first > second) {
      throw new ChainError(`first size ${String(first)} must be within 1..${String(second)}`);
    }
    if (first === second) return [];
    return this.subproof(0, second, first, true).map(bytesToHex);
  }

  private assertSize(size: number): void {
    if (!Number.isInteger(size) || size < 0 || size > this.size) {
      throw new ChainError(`tree size ${String(size)} is outside 0..${String(this.size)}`);
    }
  }

  private row(level: number): Uint8Array[] {
    const row = this.levels[level] ?? [];
    this.levels[level] = row;
    return row;
  }

  // Aligned power-of-two ranges are complete subtrees and therefore cached; only the right spine recurses.
  private hashRange(lo: number, hi: number): Uint8Array {
    const n = hi - lo;
    const level = Math.log2(n);
    const cached = Number.isInteger(level) && lo % n === 0 ? this.row(level)[lo / n] : undefined;
    if (cached !== undefined) return cached;
    const k = largestPowerOfTwoBelow(n);
    return nodeHash(this.hashRange(lo, lo + k), this.hashRange(lo + k, hi));
  }

  // RFC 6962 §2.1.1
  private path(lo: number, hi: number, index: number): Uint8Array[] {
    if (hi - lo === 1) return [];
    const k = largestPowerOfTwoBelow(hi - lo);
    return index < lo + k
      ? [...this.path(lo, lo + k, index), this.hashRange(lo + k, hi)]
      : [...this.path(lo + k, hi, index), this.hashRange(lo, lo + k)];
  }

  // RFC 6962 §2.1.2
  private subproof(lo: number, hi: number, first: number, complete: boolean): Uint8Array[] {
    if (first === hi) return complete ? [] : [this.hashRange(lo, hi)];
    const k = largestPowerOfTwoBelow(hi - lo);
    return first <= lo + k
      ? [...this.subproof(lo, lo + k, first, complete), this.hashRange(lo + k, hi)]
      : [...this.subproof(lo + k, hi, first, false), this.hashRange(lo, lo + k)];
  }
}

// RFC 9162 §2.1.3.2
export function verifyInclusion(
  data: Uint8Array,
  index: number,
  size: number,
  proof: readonly string[],
  root: string,
): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= size) return false;
  let fn = index;
  let sn = size - 1;
  let r: Uint8Array = leafHash(data);
  for (const hex of proof) {
    if (sn === 0) return false;
    const p = hexToBytes(hex);
    if (isOdd(fn) || fn === sn) {
      r = nodeHash(p, r);
      while (!isOdd(fn) && fn !== 0) {
        fn = halve(fn);
        sn = halve(sn);
      }
    } else {
      r = nodeHash(r, p);
    }
    fn = halve(fn);
    sn = halve(sn);
  }
  return sn === 0 && bytesToHex(r) === root;
}

// RFC 9162 §2.1.4.2
export function verifyConsistency(
  first: number,
  second: number,
  firstRoot: string,
  secondRoot: string,
  proof: readonly string[],
): boolean {
  if (!Number.isInteger(first) || first < 1 || first > second) return false;
  if (first === second) return proof.length === 0 && firstRoot === secondRoot;
  const [proofHead, ...proofRest] = proof;
  if (proofHead === undefined) return false;
  const firstIsPowerOfTwo = Number.isInteger(Math.log2(first));
  const head = firstIsPowerOfTwo ? firstRoot : proofHead;
  const rest = firstIsPowerOfTwo ? [proofHead, ...proofRest] : proofRest;
  let fn = first - 1;
  let sn = second - 1;
  while (isOdd(fn)) {
    fn = halve(fn);
    sn = halve(sn);
  }
  let fr: Uint8Array = hexToBytes(head);
  let sr: Uint8Array = fr;
  for (const hex of rest) {
    if (sn === 0) return false;
    const c = hexToBytes(hex);
    if (isOdd(fn) || fn === sn) {
      fr = nodeHash(c, fr);
      sr = nodeHash(c, sr);
      while (!isOdd(fn) && fn !== 0) {
        fn = halve(fn);
        sn = halve(sn);
      }
    } else {
      sr = nodeHash(sr, c);
    }
    fn = halve(fn);
    sn = halve(sn);
  }
  return sn === 0 && bytesToHex(fr) === firstRoot && bytesToHex(sr) === secondRoot;
}
