import type { Event } from '@debrief/schema';

const ZERO = '0'.repeat(64);
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const AGENT = { type: 'agent', id: 'agent:worker', name: 'worker' } as const;
export const HUMAN = { type: 'human', id: 'human:pat', name: 'Pat' } as const;

export const ulid = (seq: number): string =>
  `01J8ZK5R4M2X6P9Q3V7W1Y5N${ALPHABET[Math.floor(seq / 32)] ?? '0'}${ALPHABET[seq % 32] ?? '0'}`;

export const at = (seq: number, offsetMs = 0): string =>
  new Date(Date.UTC(2026, 8, 17, 0, 0, 0) + seq * 1000 + offsetMs).toISOString();

export const ev = (seq: number, patch: Partial<Event> & Pick<Event, 'kind'>): Event => ({
  id: ulid(seq),
  tenantId: 't',
  seq,
  ts: at(seq),
  sourceTs: at(seq),
  source: 'api',
  provenance: 'reported',
  runId: 'run-x',
  actor: AGENT,
  attrs: {},
  prevHash: ZERO,
  hash: ZERO,
  ...patch,
});
