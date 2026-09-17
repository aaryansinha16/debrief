import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export const API_KEY_PREFIX = 'dbf_';

export interface GeneratedApiKey {
  key: string;
  prefix: string;
  keyHash: string;
}

export function hashApiKey(key: string): string {
  return bytesToHex(sha256(utf8ToBytes(key)));
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function generateApiKey(): GeneratedApiKey {
  const key = `${API_KEY_PREFIX}${base64url(randomBytes(32))}`;
  return { key, prefix: key.slice(0, 12), keyHash: hashApiKey(key) };
}

export function parseBearer(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const key = /^Bearer\s+(\S+)$/i.exec(header.trim())?.[1];
  return key?.startsWith(API_KEY_PREFIX) ? key : undefined;
}
