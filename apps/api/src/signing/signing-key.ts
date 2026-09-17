import { readFileSync } from 'node:fs';

import { type Keypair, type PublicKeyEntry, generateKeypair, publicKeyEntry } from '@debrief/chain';
import { hexToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';

import { type Config, resolveFromRepoRoot } from '../config/config.js';

const signingKeyFileSchema = z.object({ secretKey: z.string().regex(/^[0-9a-f]{64}$/) });

export const SIGNING_KEY = Symbol('SIGNING_KEY');

export interface SigningKey {
  keypair: Keypair;
  publicKeys: PublicKeyEntry[];
}

export function loadSigningKey(
  config: Pick<Config, 'SIGNING_KEY_FILE' | 'SIGNING_KEY_SECRET'>,
): SigningKey {
  const secretHex =
    config.SIGNING_KEY_SECRET ??
    signingKeyFileSchema.parse(
      JSON.parse(readFileSync(resolveFromRepoRoot(config.SIGNING_KEY_FILE ?? ''), 'utf8')),
    ).secretKey;
  const keypair = generateKeypair(hexToBytes(secretHex));
  return { keypair, publicKeys: [publicKeyEntry(keypair.publicKey)] };
}
