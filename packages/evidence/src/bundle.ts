import { sha256Hex } from '@debrief/chain';
import { type Checkpoint, type Event, checkpointSchema, eventSchema } from '@debrief/schema';
import { type Zippable, unzipSync, zipSync } from 'fflate';
import { z } from 'zod';

import { bytesToHex, hexToBytes, utf8 } from './hex.js';

export const BUNDLE_VERSION = '1';

export const FILES = {
  manifest: 'manifest.json',
  events: 'events.jsonl',
  checkpoints: 'checkpoints.json',
  proofs: 'proofs.json',
  report: 'report.md',
  regulationMap: 'regulation_map.json',
  signature: 'SIGNATURE',
} as const;

export const BLOB_DIR = 'blobs/';

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);

// ARCHITECTURE §12 manifest, plus the SHA-256 of every other file so the detached signature covers the whole bundle (D-062).
export const manifestSchema = z.strictObject({
  version: z.literal(BUNDLE_VERSION),
  tenantId: z.string().min(1),
  runIds: z.array(z.string().min(1)).min(1),
  timeRange: z.object({ from: z.string(), to: z.string() }),
  keyId: z.string().min(1),
  publicKey: z.string().regex(/^[0-9a-f]{64}$/),
  alg: z.literal('ed25519'),
  redaction: z.object({ summaries: z.literal(true), includeContent: z.boolean() }),
  generatedAt: z.string(),
  files: z.record(z.string(), hex64),
});
export type Manifest = z.infer<typeof manifestSchema>;

export const inclusionProofSchema = z.strictObject({
  seq: z.number().int().nonnegative(),
  treeSize: z.number().int().positive(),
  proof: z.array(hex64),
});
export const consistencyProofSchema = z.strictObject({
  first: z.number().int().positive(),
  second: z.number().int().positive(),
  proof: z.array(hex64),
});
export const proofsSchema = z.strictObject({
  inclusion: z.array(inclusionProofSchema),
  consistency: z.array(consistencyProofSchema),
});
export type Proofs = z.infer<typeof proofsSchema>;

export const blobDocumentSchema = z.object({
  sourceId: z.string(),
  content: z.record(z.string(), z.string()),
});
export type BlobDocument = z.infer<typeof blobDocumentSchema>;

export interface ExportPolicy {
  includeContent: boolean;
}

export interface BundleInput {
  tenantId: string;
  runIds: readonly string[];
  events: readonly Event[];
  checkpoints: readonly Checkpoint[];
  proofs: Proofs;
  keyId: string;
  publicKey: string;
  report: string;
  regulationMap: unknown;
  generatedAt: string;
  policy: ExportPolicy;
  blobs?: Readonly<Record<string, Uint8Array>>;
}

export interface Bundle {
  manifest: Manifest;
  events: Event[];
  checkpoints: Checkpoint[];
  proofs: Proofs;
  report: string;
  regulationMap: unknown;
  signature: string;
  blobs: Record<string, BlobDocument>;
  files: Record<string, Uint8Array>;
}

export class BundleFormatError extends Error {
  override readonly name = 'BundleFormatError';

  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
  }
}

export type Signer = (digest: Uint8Array) => Uint8Array;

const sortedEvents = (events: readonly Event[]): Event[] =>
  [...events].sort((a, b) => a.seq - b.seq);

// Zip entries carry a DOS date (1980–2099); the bundle's own time is the manifest's generatedAt.
const mtimeOf = (generatedAt: string): Date => {
  const parsed = new Date(generatedAt);
  const year = parsed.getUTCFullYear();
  return Number.isNaN(parsed.getTime()) || year < 1980 || year > 2099
    ? new Date(Date.UTC(2000, 0, 1))
    : parsed;
};

// Summaries always travel; sealed content only when the export policy says so. The manifest is signed last, over its own SHA-256.
export function packBundle(input: BundleInput, sign: Signer): Uint8Array {
  const events = sortedEvents(input.events);
  const files: Record<string, Uint8Array> = {
    [FILES.events]: utf8.encode(events.map((event) => JSON.stringify(event)).join('\n') + '\n'),
    [FILES.checkpoints]: utf8.encode(JSON.stringify(input.checkpoints, null, 2)),
    [FILES.proofs]: utf8.encode(JSON.stringify(input.proofs, null, 2)),
    [FILES.report]: utf8.encode(input.report),
    [FILES.regulationMap]: utf8.encode(JSON.stringify(input.regulationMap, null, 2)),
  };
  // Sealed documents travel byte for byte: their SHA-256 is their name, as the API sealed them.
  if (input.policy.includeContent) {
    for (const [sha, document] of Object.entries(input.blobs ?? {})) {
      files[`${BLOB_DIR}${sha}.json`] = document;
    }
  }
  const timestamps = events.map((event) => event.ts).sort();
  const manifest: Manifest = {
    version: BUNDLE_VERSION,
    tenantId: input.tenantId,
    runIds: [...input.runIds],
    timeRange: {
      from: timestamps[0] ?? input.generatedAt,
      to: timestamps.at(-1) ?? input.generatedAt,
    },
    keyId: input.keyId,
    publicKey: input.publicKey,
    alg: 'ed25519',
    redaction: { summaries: true, includeContent: input.policy.includeContent },
    generatedAt: input.generatedAt,
    files: Object.fromEntries(
      Object.entries(files)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([name, bytes]) => [name, sha256Hex(bytes)]),
    ),
  };
  const manifestBytes = utf8.encode(JSON.stringify(manifest, null, 2));
  const signature = bytesToHex(sign(hexToBytes(sha256Hex(manifestBytes))));
  const mtime = mtimeOf(input.generatedAt);
  const entries: Zippable = {};
  for (const [name, bytes] of Object.entries({
    [FILES.manifest]: manifestBytes,
    ...files,
    [FILES.signature]: utf8.encode(`${signature}\n`),
  })) {
    entries[name] = [bytes, { mtime }];
  }
  return zipSync(entries, { level: 6 });
}

const parseJson = <T>(file: string, bytes: Uint8Array, schema: z.ZodType<T>): T => {
  let raw: unknown;
  try {
    raw = JSON.parse(utf8.decode(bytes));
  } catch {
    throw new BundleFormatError(file, 'not json');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new BundleFormatError(file, parsed.error.issues.map((issue) => issue.message).join('; '));
  }
  return parsed.data;
};

const require = (files: Record<string, Uint8Array>, name: string): Uint8Array => {
  const bytes = files[name];
  if (bytes === undefined) throw new BundleFormatError(name, 'missing');
  return bytes;
};

// Reads every file back with the schemas; nothing is verified here, so a tampered bundle still unpacks and then fails verification with a location.
export function unpackBundle(zip: Uint8Array): Bundle {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch {
    throw new BundleFormatError('bundle.zip', 'not a zip');
  }
  const manifest = parseJson(FILES.manifest, require(files, FILES.manifest), manifestSchema);
  const events: Event[] = [];
  utf8
    .decode(require(files, FILES.events))
    .split('\n')
    .forEach((line, index) => {
      if (line.trim() === '') return;
      events.push(
        parseJson(`${FILES.events}:${String(index + 1)}`, utf8.encode(line), eventSchema),
      );
    });
  const checkpoints = parseJson(
    FILES.checkpoints,
    require(files, FILES.checkpoints),
    z.array(checkpointSchema),
  );
  const proofs = parseJson(FILES.proofs, require(files, FILES.proofs), proofsSchema);
  const signature = utf8.decode(require(files, FILES.signature)).trim();
  const blobs: Record<string, BlobDocument> = {};
  for (const [name, bytes] of Object.entries(files)) {
    if (!name.startsWith(BLOB_DIR) || !name.endsWith('.json')) continue;
    blobs[name.slice(BLOB_DIR.length, -'.json'.length)] = parseJson(
      name,
      bytes,
      blobDocumentSchema,
    );
  }
  return {
    manifest,
    events,
    checkpoints,
    proofs,
    report: utf8.decode(require(files, FILES.report)),
    regulationMap: parseJson(FILES.regulationMap, require(files, FILES.regulationMap), z.unknown()),
    signature,
    blobs,
    files,
  };
}
