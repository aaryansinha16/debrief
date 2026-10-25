import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'sha256=';

export function sign(secret: string, body: Buffer): string {
  return PREFIX + createHmac('sha256', secret).update(body).digest('hex');
}

export function verifySignature(secret: string, body: Buffer, header: string | undefined): boolean {
  if (header?.startsWith(PREFIX) !== true) return false;
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
