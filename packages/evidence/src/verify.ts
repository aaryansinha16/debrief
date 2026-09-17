import {
  hashEvent,
  sha256Hex,
  verifyBytes,
  verifyCheckpoint,
  verifyConsistency,
  verifyInclusion,
} from '@debrief/chain';
import type { Checkpoint, Event } from '@debrief/schema';

import { type Bundle, FILES } from './bundle.js';
import { hexToBytes } from './hex.js';

export type CheckName =
  | 'file-digest'
  | 'manifest-signature'
  | 'checkpoint-signature'
  | 'checkpoint-consistency'
  | 'event-hash'
  | 'event-order'
  | 'event-inclusion'
  | 'blob-digest';

export interface Check {
  name: CheckName;
  ok: boolean;
  subject: string;
  seq?: number;
  detail?: string;
}

export interface BundleVerification {
  ok: boolean;
  checks: Check[];
  failedAt?: Check;
  events: number;
  checkpoints: number;
}

// The bundle is verified with packages/chain alone: digests and the detached signature, then the checkpoints, then every event.
// The first failing check is pinned with its seq (or file) so a verifier can show where the chain broke.
export function verifyBundle(bundle: Bundle): BundleVerification {
  const checks: Check[] = [];
  const add = (check: Check): void => {
    checks.push(check);
  };
  const { manifest } = bundle;
  const manifestBytes = bundle.files[FILES.manifest];
  for (const [name, digest] of Object.entries(manifest.files)) {
    const bytes = bundle.files[name];
    const actual = bytes === undefined ? undefined : sha256Hex(bytes);
    add({
      name: 'file-digest',
      ok: actual === digest,
      subject: name,
      ...(actual === digest ? {} : { detail: bytes === undefined ? 'missing' : 'digest differs' }),
    });
  }
  for (const name of Object.keys(bundle.files)) {
    if (name === FILES.manifest || name === FILES.signature || name in manifest.files) continue;
    add({ name: 'file-digest', ok: false, subject: name, detail: 'not in the manifest' });
  }
  const publicKey = { keyId: manifest.keyId, alg: manifest.alg, publicKey: manifest.publicKey };
  const signed = signatureOk(bundle.signature, manifestBytes, manifest.publicKey);
  add({
    name: 'manifest-signature',
    ok: signed,
    subject: FILES.signature,
    ...(signed ? {} : { detail: 'the detached signature does not verify with the manifest key' }),
  });
  const bySize = new Map<number, Checkpoint>();
  for (const checkpoint of bundle.checkpoints) {
    const verdict = verifyCheckpoint(checkpoint, [publicKey]);
    add({
      name: 'checkpoint-signature',
      ok: verdict.ok,
      subject: `checkpoint ${String(checkpoint.treeSize)}`,
      ...(verdict.ok ? {} : { detail: verdict.reason }),
    });
    bySize.set(checkpoint.treeSize, checkpoint);
  }
  for (const proof of bundle.proofs.consistency) {
    const first = bySize.get(proof.first);
    const second = bySize.get(proof.second);
    const ok =
      first !== undefined &&
      second !== undefined &&
      verifyConsistency(
        first.treeSize,
        second.treeSize,
        first.rootHash,
        second.rootHash,
        proof.proof,
      );
    add({
      name: 'checkpoint-consistency',
      ok,
      subject: `checkpoint ${String(proof.first)} → ${String(proof.second)}`,
      ...(ok
        ? {}
        : {
            detail:
              first === undefined || second === undefined
                ? 'checkpoint missing'
                : 'proof does not verify',
          }),
    });
  }
  const proofsBySeq = new Map(bundle.proofs.inclusion.map((proof) => [proof.seq, proof]));
  let previous: Event | undefined;
  for (const event of bundle.events) {
    const ordered = previous === undefined || event.seq > previous.seq;
    add({
      name: 'event-order',
      ok: ordered,
      subject: event.id,
      seq: event.seq,
      ...(ordered ? {} : { detail: `seq ${String(event.seq)} after ${String(previous?.seq)}` }),
    });
    const { hash, prevHash, ...rest } = event;
    const hashOk = hashEvent(prevHash, rest) === hash;
    add({
      name: 'event-hash',
      ok: hashOk,
      subject: event.id,
      seq: event.seq,
      ...(hashOk ? {} : { detail: 'the event does not hash to its recorded hash' }),
    });
    const proof = proofsBySeq.get(event.seq);
    const checkpoint = proof === undefined ? undefined : bySize.get(proof.treeSize);
    const included =
      proof !== undefined &&
      checkpoint !== undefined &&
      verifyInclusion(
        hexToBytes(hash),
        event.seq,
        proof.treeSize,
        proof.proof,
        checkpoint.rootHash,
      );
    add({
      name: 'event-inclusion',
      ok: included,
      subject: event.id,
      seq: event.seq,
      ...(included
        ? {}
        : {
            detail:
              proof === undefined
                ? 'no inclusion proof'
                : checkpoint === undefined
                  ? `no checkpoint of size ${String(proof.treeSize)}`
                  : 'inclusion proof does not verify against the checkpoint root',
          }),
    });
    previous = event;
  }
  for (const sha of Object.keys(bundle.blobs)) {
    const bytes = bundle.files[`blobs/${sha}.json`];
    const digest = bytes === undefined ? undefined : sha256Hex(bytes);
    add({
      name: 'blob-digest',
      ok: digest === sha,
      subject: `blobs/${sha}.json`,
      ...(digest === sha ? {} : { detail: 'the sealed document does not hash to its name' }),
    });
  }
  const failedAt = checks.find((check) => !check.ok);
  return {
    ok: failedAt === undefined,
    checks,
    ...(failedAt === undefined ? {} : { failedAt }),
    events: bundle.events.length,
    checkpoints: bundle.checkpoints.length,
  };
}

function signatureOk(
  signature: string,
  manifestBytes: Uint8Array | undefined,
  publicKey: string,
): boolean {
  if (manifestBytes === undefined) return false;
  try {
    return verifyBytes(
      hexToBytes(signature),
      hexToBytes(sha256Hex(manifestBytes)),
      hexToBytes(publicKey),
    );
  } catch {
    return false;
  }
}
