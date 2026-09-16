import type { Event } from '@debrief/schema';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

import { canonicalize } from './canonicalize.js';
import { ChainError } from './errors.js';

export type UnhashedEvent = Omit<Event, 'hash' | 'prevHash'>;

export const GENESIS_HASH = '0'.repeat(64);

const HEX64 = /^[0-9a-f]{64}$/;

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

// hash = SHA-256(bytes(prevHash) ‖ utf8(canonical(event without hash))); the prevHash argument is authoritative.
export function hashEvent(prevHash: string, event: UnhashedEvent): string {
  if (!HEX64.test(prevHash)) throw new ChainError('prevHash must be 64 lowercase hex characters');
  const { hash: _hash, ...rest } = event as UnhashedEvent & { hash?: string };
  const canonical = canonicalize({ ...rest, prevHash });
  return sha256Hex(concatBytes(hexToBytes(prevHash), utf8ToBytes(canonical)));
}

export function chainEvents(events: readonly UnhashedEvent[], prevHash = GENESIS_HASH): Event[] {
  const out: Event[] = [];
  let prev = prevHash;
  for (const event of events) {
    const hash = hashEvent(prev, event);
    out.push({ ...event, prevHash: prev, hash });
    prev = hash;
  }
  return out;
}
