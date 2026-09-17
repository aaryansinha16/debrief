import { randomBytes } from '@noble/hashes/utils.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encode(value: bigint, length: number): string {
  let out = '';
  let rest = value;
  for (let i = 0; i < length; i += 1) {
    out = `${ALPHABET.charAt(Number(rest & 31n))}${out}`;
    rest >>= 5n;
  }
  return out;
}

export function ulid(now = Date.now()): string {
  const random = randomBytes(10).reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
  return encode(BigInt(now), 10) + encode(random, 16);
}
