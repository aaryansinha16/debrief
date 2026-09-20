import type { Anchor, Checkpoint } from '@debrief/schema';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

import { canonicalize } from './canonicalize.js';

export interface AnchorRequest {
  digest: Uint8Array;
  tenantId: string;
  treeSize: number;
}

// ARCHITECTURE §7.6: an external witness for a checkpoint; v1 ships the interface, a no-op and an RFC 3161 client without transport.
export interface Anchorer {
  readonly kind: 'none' | Anchor['kind'];
  anchor(request: AnchorRequest): Promise<Anchor | undefined>;
}

export const NO_ANCHOR: Anchorer = {
  kind: 'none',
  anchor: () => Promise.resolve(undefined),
};

export class AnchorError extends Error {
  override readonly name = 'AnchorError';
}

// What a witness timestamps: the checkpoint body without its anchor and signature, so the anchor can be checked from the checkpoint itself.
export function anchorDigest(
  checkpoint: Omit<Checkpoint, 'signature' | 'anchor'> &
    Partial<Pick<Checkpoint, 'signature' | 'anchor'>>,
): Uint8Array {
  const { signature: _signature, anchor: _anchor, ...body } = checkpoint;
  return sha256(utf8ToBytes(canonicalize(body)));
}

// --- DER, only what a TimeStampReq needs and a TimeStampResp status check reads ---

const TAG = {
  integer: 0x02,
  octetString: 0x04,
  null: 0x05,
  oid: 0x06,
  sequence: 0x30,
  boolean: 0x01,
} as const;
const SHA256_OID = Uint8Array.from([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);

function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  if (length < 0x100) return [0x81, length];
  if (length < 0x10000) return [0x82, length >> 8, length & 0xff];
  throw new AnchorError('DER value too long');
}

export function der(tag: number, ...contents: Uint8Array[]): Uint8Array {
  const length = contents.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(1 + derLength(length).length + length);
  out[0] = tag;
  const header = derLength(length);
  out.set(header, 1);
  let offset = 1 + header.length;
  for (const part of contents) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// A DER INTEGER is signed: a leading byte with its high bit set needs a zero in front to stay positive.
const derInteger = (bytes: Uint8Array): Uint8Array => {
  const first = bytes[0];
  const negative = first !== undefined && first >= 0x80;
  return der(TAG.integer, negative ? Uint8Array.from([0, ...bytes]) : bytes);
};

// RFC 3161 §2.4.1: TimeStampReq { version 1, messageImprint { sha256, digest }, nonce?, certReq TRUE }.
export function timestampRequest(digest: Uint8Array, nonce?: Uint8Array): Uint8Array {
  if (digest.length !== 32) throw new AnchorError('the message imprint must be a SHA-256 digest');
  const algorithm = der(TAG.sequence, der(TAG.oid, SHA256_OID), der(TAG.null));
  const imprint = der(TAG.sequence, algorithm, der(TAG.octetString, digest));
  const parts = [derInteger(Uint8Array.from([1])), imprint];
  if (nonce !== undefined) parts.push(derInteger(nonce));
  parts.push(der(TAG.boolean, Uint8Array.from([0xff])));
  return der(TAG.sequence, ...parts);
}

export interface Tlv {
  tag: number;
  start: number;
  end: number;
}

export function readTlv(bytes: Uint8Array, offset: number): Tlv {
  const tag = bytes[offset];
  const first = bytes[offset + 1];
  if (tag === undefined || first === undefined) throw new AnchorError('DER truncated');
  if (first < 0x80) {
    if (offset + 2 + first > bytes.length) throw new AnchorError('DER truncated');
    return { tag, start: offset + 2, end: offset + 2 + first };
  }
  const count = first & 0x7f;
  if (count === 0 || count > 2) throw new AnchorError('DER length not supported');
  let length = 0;
  for (let index = 0; index < count; index += 1) {
    const byte = bytes[offset + 2 + index];
    if (byte === undefined) throw new AnchorError('DER truncated');
    length = (length << 8) | byte;
  }
  const start = offset + 2 + count;
  if (start + length > bytes.length) throw new AnchorError('DER truncated');
  return { tag, start, end: start + length };
}

export type PkiStatus =
  | 'granted'
  | 'grantedWithMods'
  | 'rejection'
  | 'waiting'
  | 'revocationWarning'
  | 'revocationNotification'
  | 'unknown';

const STATUSES: PkiStatus[] = [
  'granted',
  'grantedWithMods',
  'rejection',
  'waiting',
  'revocationWarning',
  'revocationNotification',
];

export interface TimestampResponse {
  status: PkiStatus;
  hasToken: boolean;
  imprintPresent: boolean;
}

const contains = (haystack: Uint8Array, needle: Uint8Array): boolean => {
  for (let at = 0; at + needle.length <= haystack.length; at += 1) {
    let matched = true;
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[at + index] !== needle[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
};

// RFC 3161 §2.4.2: TimeStampResp { status PKIStatusInfo { status INTEGER, ... }, timeStampToken? }; the token must carry our imprint.
export function readTimestampResponse(bytes: Uint8Array, digest: Uint8Array): TimestampResponse {
  const outer = readTlv(bytes, 0);
  if (outer.tag !== TAG.sequence) throw new AnchorError('not a TimeStampResp');
  const statusInfo = readTlv(bytes, outer.start);
  if (statusInfo.tag !== TAG.sequence) throw new AnchorError('not a PKIStatusInfo');
  const statusInt = readTlv(bytes, statusInfo.start);
  if (statusInt.tag !== TAG.integer || statusInt.end - statusInt.start !== 1) {
    throw new AnchorError('PKIStatus is not a small integer');
  }
  const code = bytes.subarray(statusInt.start, statusInt.end).reduce((_, byte) => byte, 255);
  const status = STATUSES.at(code) ?? 'unknown';
  const hasToken = statusInfo.end < outer.end;
  const token = hasToken ? bytes.subarray(statusInfo.end, outer.end) : new Uint8Array();
  return { status, hasToken, imprintPresent: contains(token, digest) };
}

export type TsaTransport = (request: Uint8Array) => Promise<Uint8Array>;

const base64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export const fromBase64 = (text: string): Uint8Array =>
  Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

// The anchor's ref is the whole TimeStampResp, base64: everything a later verifier needs to check the witness offline.
export function rfc3161Anchorer(transport: TsaTransport, nonce?: () => Uint8Array): Anchorer {
  return {
    kind: 'rfc3161',
    anchor: async ({ digest }) => {
      const response = await transport(timestampRequest(digest, nonce?.()));
      const parsed = readTimestampResponse(response, digest);
      if (parsed.status !== 'granted' && parsed.status !== 'grantedWithMods') {
        throw new AnchorError(`timestamp ${parsed.status}`);
      }
      if (!parsed.hasToken) throw new AnchorError('timestamp granted without a token');
      if (!parsed.imprintPresent)
        throw new AnchorError('timestamp token does not carry the digest');
      return { kind: 'rfc3161', ref: base64(response) };
    },
  };
}

// Reads a stored anchor back against its checkpoint: the witness must have signed the digest the checkpoint hashes to.
export function readAnchor(checkpoint: Checkpoint): TimestampResponse | undefined {
  if (checkpoint.anchor?.kind !== 'rfc3161') return undefined;
  return readTimestampResponse(fromBase64(checkpoint.anchor.ref), anchorDigest(checkpoint));
}
