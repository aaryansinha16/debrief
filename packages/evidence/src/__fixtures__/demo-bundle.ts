import {
  MerkleTree,
  generateKeypair,
  signBytes,
  signCheckpoint,
  verifyChain,
} from '@debrief/chain';
import { PROD_GUARD_YAML, parsePolicy } from '@debrief/policy';
import { authorityLineage, blastRadius, divergence, reconstructGraph } from '@debrief/reconstruct';
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import type { Checkpoint, Event } from '@debrief/schema';

import type { BundleInput, Proofs, Signer } from '../bundle.js';
import { bytesToHex, hexToBytes } from '../hex.js';
import { renderReport } from '../report.js';

export interface DemoBundle {
  input: BundleInput;
  sign: Signer;
  tenantEvents: Event[];
  runEvents: Event[];
  checkpoints: Checkpoint[];
  secretKey: Uint8Array;
}

export interface DemoBundleOptions {
  checkpoints?: 'one' | 'two';
}

// The demo tenant's chain (both runs), signed checkpoints and the proofs for one run: what the API would hand the packer.
export function demoBundle(
  seed = 'evidence-test',
  { checkpoints: how = 'two' }: DemoBundleOptions = {},
): DemoBundle {
  const tenantEvents = [...demoRunFixture()].sort((a, b) => a.seq - b.seq);
  const chain = verifyChain(tenantEvents);
  if (!chain.ok) throw new Error(`fixture chain breaks at ${String(chain.seq)}`);
  const keypair = generateKeypair(new TextEncoder().encode(seed.padEnd(32, '.')).slice(0, 32));
  const tree = new MerkleTree();
  for (const event of tenantEvents) tree.append(hexToBytes(event.hash));
  const sizes = how === 'two' ? [30, tenantEvents.length] : [tenantEvents.length];
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
      const treeSize = how === 'two' && event.seq < 30 ? 30 : tenantEvents.length;
      return { seq: event.seq, treeSize, proof: tree.inclusionProof(event.seq, treeSize) };
    }),
    consistency:
      how === 'two'
        ? [{ first: 30, second: tenantEvents.length, proof: tree.consistencyProof(30) }]
        : [],
  };
  const sign: Signer = (digest) => signBytes(digest, keypair.secretKey);
  const graph = reconstructGraph(tenantEvents, { runId: DEMO_RUN_ID });
  const report = divergence(tenantEvents, parsePolicy(PROD_GUARD_YAML), graph);
  const origin = report.freezeFrame?.nodeId;
  const generatedAt = '2026-09-17T12:00:00.000Z';
  const rendered = renderReport({
    run: {
      id: DEMO_RUN_ID,
      tenantId: tenantEvents[0]?.tenantId ?? 'tenant-demo',
      agentName: 'coding-agent',
      principalId: 'human:aaryan',
    },
    events: runEvents,
    checkpoints,
    policyId: 'prod-guard',
    divergence: report,
    ...(origin === undefined ? {} : { lineage: authorityLineage(graph, origin, tenantEvents) }),
    ...(origin === undefined ? {} : { blast: blastRadius(graph, origin, tenantEvents) }),
    includeContent: false,
    generatedAt,
  });
  return {
    input: {
      tenantId: tenantEvents[0]?.tenantId ?? 'tenant-demo',
      runIds: [DEMO_RUN_ID],
      events: runEvents,
      checkpoints,
      proofs,
      keyId: keypair.keyId,
      publicKey: bytesToHex(keypair.publicKey),
      report: rendered.markdown,
      regulationMap: rendered.regulationMap,
      generatedAt,
      policy: { includeContent: false },
    },
    sign,
    tenantEvents,
    runEvents,
    checkpoints,
    secretKey: keypair.secretKey,
  };
}
