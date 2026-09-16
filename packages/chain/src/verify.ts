import type { Event } from '@debrief/schema';

import { GENESIS_HASH, hashEvent } from './hash.js';

export type ChainBreak = 'seq' | 'prev-hash' | 'hash' | 'head';

export type ChainVerification =
  { ok: true; length: number; headHash: string } | { ok: false; seq: number; reason: ChainBreak };

export interface VerifyChainOptions {
  startSeq?: number;
  prevHash?: string;
  headHash?: string;
}

// Strict by default: the slice must start at seq 0 from the genesis hash unless the caller pins startSeq/prevHash.
export function verifyChain(
  events: readonly Event[],
  options: VerifyChainOptions = {},
): ChainVerification {
  let expectedSeq = options.startSeq ?? 0;
  let prev = options.prevHash ?? GENESIS_HASH;
  for (const event of events) {
    if (event.seq !== expectedSeq) return { ok: false, seq: expectedSeq, reason: 'seq' };
    if (event.prevHash !== prev) return { ok: false, seq: expectedSeq, reason: 'prev-hash' };
    if (hashEvent(prev, event) !== event.hash)
      return { ok: false, seq: expectedSeq, reason: 'hash' };
    prev = event.hash;
    expectedSeq += 1;
  }
  if (options.headHash !== undefined && options.headHash !== prev) {
    return { ok: false, seq: expectedSeq, reason: 'head' };
  }
  return { ok: true, length: events.length, headHash: prev };
}
