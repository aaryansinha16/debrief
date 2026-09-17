import {
  MerkleTree,
  generateKeypair,
  signBytes,
  signCheckpoint,
  verifyChain,
} from '@debrief/chain';
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import type { Checkpoint, Event } from '@debrief/schema';

import type { BundleInput, Proofs, Signer } from '../bundle.js';
import { bytesToHex, hexToBytes } from '../hex.js';

export interface DemoBundle {
  input: BundleInput;
  sign: Signer;
  tenantEvents: Event[];
  runEvents: Event[];
  checkpoints: Checkpoint[];
  secretKey: Uint8Array;
}

// The demo tenant's chain (both runs), two signed checkpoints and the proofs for one run: what the API would hand the packer.
export function demoBundle(seed = 'evidence-test'): DemoBundle {
  const tenantEvents = [...demoRunFixture()].sort((a, b) => a.seq - b.seq);
  const chain = verifyChain(tenantEvents);
  if (!chain.ok) throw new Error(`fixture chain breaks at ${String(chain.seq)}`);
  const keypair = generateKeypair(new TextEncoder().encode(seed.padEnd(32, '.')).slice(0, 32));
  const tree = new MerkleTree();
  for (const event of tenantEvents) tree.append(hexToBytes(event.hash));
  const sizes = [30, tenantEvents.length];
  const checkpoints = sizes.map((treeSize) =>
    signCheckpoint(
      {
        tenantId: tenantEvents[0]?.tenantId ?? 'tenant-demo',
        treeSize,
        rootHash: tree.rootAt(treeSize),
        headHash: tenantEvents[treeSize - 1]?.hash ?? '',
        ts: '2026-09-17T10:38:30.000Z',
      },
      keypair.secretKey,
    ),
  );
  const runEvents = tenantEvents.filter((event) => event.runId === DEMO_RUN_ID);
  const proofs: Proofs = {
    inclusion: runEvents.map((event) => {
      const treeSize = event.seq < 30 ? 30 : tenantEvents.length;
      return { seq: event.seq, treeSize, proof: tree.inclusionProof(event.seq, treeSize) };
    }),
    consistency: [{ first: 30, second: tenantEvents.length, proof: tree.consistencyProof(30) }],
  };
  const sign: Signer = (digest) => signBytes(digest, keypair.secretKey);
  return {
    input: {
      tenantId: tenantEvents[0]?.tenantId ?? 'tenant-demo',
      runIds: [DEMO_RUN_ID],
      events: runEvents,
      checkpoints,
      proofs,
      keyId: keypair.keyId,
      publicKey: bytesToHex(keypair.publicKey),
      report: '# report\n\npending P-44\n',
      regulationMap: { version: '0', pending: 'P-44' },
      generatedAt: '2026-09-17T12:00:00.000Z',
      policy: { includeContent: false },
    },
    sign,
    tenantEvents,
    runEvents,
    checkpoints,
    secretKey: keypair.secretKey,
  };
}
