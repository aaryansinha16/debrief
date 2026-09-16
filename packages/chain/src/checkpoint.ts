import type { Checkpoint } from '@debrief/schema';
import * as ed from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

import { canonicalize } from './canonicalize.js';

ed.hashes.sha512 = sha512;

export type UnsignedCheckpoint = Omit<Checkpoint, 'signature' | 'keyId'>;

export interface Keypair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
  keyId: string;
}

export interface PublicKeyEntry {
  keyId: string;
  alg: string;
  publicKey: string;
}

export interface SigningKeyRecord extends PublicKeyEntry {
  secretKey: string;
}

export type CheckpointVerification =
  | { ok: true; keyId: string }
  | { ok: false; reason: 'unknown-key' | 'unsupported-alg' | 'key-id-mismatch' | 'signature' };

// keyId = first 16 hex chars of SHA-256(publicKey); the keys document carries the algorithm.
export function deriveKeyId(publicKey: Uint8Array): string {
  return bytesToHex(sha256(publicKey)).slice(0, 16);
}

export function generateKeypair(seed?: Uint8Array): Keypair {
  const { secretKey, publicKey } = ed.keygen(seed);
  return { secretKey, publicKey, keyId: deriveKeyId(publicKey) };
}

export function publicKeyEntry(publicKey: Uint8Array): PublicKeyEntry {
  return { keyId: deriveKeyId(publicKey), alg: 'ed25519', publicKey: bytesToHex(publicKey) };
}

export function signingKeyRecord(keypair: Keypair): SigningKeyRecord {
  return { ...publicKeyEntry(keypair.publicKey), secretKey: bytesToHex(keypair.secretKey) };
}

export function signBytes(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ed.sign(message, secretKey);
}

export function verifyBytes(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    return ed.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

export function checkpointSigningBytes(checkpoint: Omit<Checkpoint, 'signature'>): Uint8Array {
  const { signature: _signature, ...body } = checkpoint as Omit<Checkpoint, 'signature'> & {
    signature?: string;
  };
  return utf8ToBytes(canonicalize(body));
}

export function signCheckpoint(unsigned: UnsignedCheckpoint, secretKey: Uint8Array): Checkpoint {
  const keyId = deriveKeyId(ed.getPublicKey(secretKey));
  const body = { ...unsigned, keyId };
  const signature = bytesToHex(signBytes(checkpointSigningBytes(body), secretKey));
  return { ...body, signature };
}

export function verifyCheckpoint(
  checkpoint: Checkpoint,
  publicKeys: readonly PublicKeyEntry[],
): CheckpointVerification {
  const entry = publicKeys.find((candidate) => candidate.keyId === checkpoint.keyId);
  if (entry === undefined) return { ok: false, reason: 'unknown-key' };
  if (entry.alg !== 'ed25519') return { ok: false, reason: 'unsupported-alg' };
  const publicKey = hexToBytes(entry.publicKey);
  if (deriveKeyId(publicKey) !== checkpoint.keyId) return { ok: false, reason: 'key-id-mismatch' };
  const { signature, ...body } = checkpoint;
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = hexToBytes(signature);
  } catch {
    return { ok: false, reason: 'signature' };
  }
  return verifyBytes(signatureBytes, checkpointSigningBytes(body), publicKey)
    ? { ok: true, keyId: checkpoint.keyId }
    : { ok: false, reason: 'signature' };
}
