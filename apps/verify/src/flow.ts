import { deriveKeyId } from '@debrief/chain';
import {
  type Bundle,
  type BundleVerification,
  BundleFormatError,
  type Check,
  hexToBytes,
  unpackBundle,
  verifyBundle,
} from '@debrief/evidence';

export type Outcome =
  | { kind: 'verified'; bundle: Bundle; verdict: BundleVerification }
  | { kind: 'broken'; bundle: Bundle; verdict: BundleVerification; failedAt: Check }
  | { kind: 'unreadable'; file: string; message: string };

// NFR-6: the verifier re-derives every hash and proof from the bytes alone; nothing here touches the network.
export function verifyZip(bytes: Uint8Array): Outcome {
  let bundle: Bundle;
  try {
    bundle = unpackBundle(bytes);
  } catch (error) {
    return unreadable(error);
  }
  const verdict = verifyBundle(bundle);
  const pinned = pinFailure(verdict);
  return pinned === undefined
    ? { kind: 'verified', bundle, verdict }
    : { kind: 'broken', bundle, verdict, failedAt: pinned };
}

// The failure a reader can act on: the first one with a seq (an edited event also changes the file digest, which says less).
export function pinFailure(verdict: BundleVerification): Check | undefined {
  return verdict.checks.find((check) => !check.ok && check.seq !== undefined) ?? verdict.failedAt;
}

// unpackBundle names the file it choked on; anything else is a bug and stays an exception.
export function unreadable(error: unknown): Outcome {
  if (!(error instanceof BundleFormatError)) throw error;
  return {
    kind: 'unreadable',
    file: error.file,
    message: error.message.slice(error.file.length + 2),
  };
}

export interface LinkState {
  seq: number;
  id: string;
  kind: string;
  state: 'ok' | 'broken' | 'unreached';
}

// One link per event, in order: lit up to the first failing seq, that one broken, the rest never reached.
export function chainLinks(bundle: Bundle, verdict: BundleVerification): LinkState[] {
  const failing = new Map<number, Check>();
  for (const check of verdict.checks) {
    if (!check.ok && check.seq !== undefined && !failing.has(check.seq))
      failing.set(check.seq, check);
  }
  const firstBroken = failing.size === 0 ? undefined : Math.min(...failing.keys());
  return bundle.events.map((event) => ({
    seq: event.seq,
    id: event.id,
    kind: event.kind,
    state:
      firstBroken === undefined || event.seq < firstBroken
        ? 'ok'
        : event.seq === firstBroken
          ? 'broken'
          : 'unreached',
  }));
}

export type HashMatch =
  | { kind: 'event'; seq: number; id: string; proven: boolean }
  | { kind: 'checkpoint-root'; treeSize: number }
  | { kind: 'checkpoint-head'; treeSize: number }
  | { kind: 'none' };

// A pasted hash names an event (by hash or id) or a checkpoint (by root or head hash) inside the loaded bundle.
export function findHash(bundle: Bundle, verdict: BundleVerification, input: string): HashMatch {
  const needle = input.trim().toLowerCase();
  if (needle === '') return { kind: 'none' };
  const event = bundle.events.find(
    (candidate) => candidate.hash === needle || candidate.id.toLowerCase() === needle,
  );
  if (event !== undefined) {
    const proven = verdict.checks.some(
      (check) => check.name === 'event-inclusion' && check.seq === event.seq && check.ok,
    );
    return { kind: 'event', seq: event.seq, id: event.id, proven };
  }
  const byRoot = bundle.checkpoints.find((checkpoint) => checkpoint.rootHash === needle);
  if (byRoot !== undefined) return { kind: 'checkpoint-root', treeSize: byRoot.treeSize };
  const byHead = bundle.checkpoints.find((checkpoint) => checkpoint.headHash === needle);
  if (byHead !== undefined) return { kind: 'checkpoint-head', treeSize: byHead.treeSize };
  return { kind: 'none' };
}

export interface PublishedKey {
  keyId: string;
  alg: string;
  publicKey: string;
}

export type KeyStatus =
  | { kind: 'confirmed'; keyId: string }
  | { kind: 'mismatch'; keyId: string }
  | { kind: 'unknown'; keyId: string };

// The optional live check: is the bundle's key among the keys the API publishes, with the same public key?
export function keyStatus(bundle: Bundle, published: readonly PublishedKey[]): KeyStatus {
  const { keyId, publicKey } = bundle.manifest;
  const entry = published.find((candidate) => candidate.keyId === keyId);
  if (entry === undefined) return { kind: 'unknown', keyId };
  return entry.publicKey === publicKey && entry.alg === 'ed25519'
    ? { kind: 'confirmed', keyId }
    : { kind: 'mismatch', keyId };
}

// The manifest's own claim about its key, checked without the network: the key id must derive from the public key.
export function keyIdMatches(bundle: Bundle): boolean {
  try {
    return deriveKeyId(hexToBytes(bundle.manifest.publicKey)) === bundle.manifest.keyId;
  } catch {
    return false;
  }
}
