import type { Event } from '@debrief/schema';

const ZERO = '0'.repeat(64);
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const AGENT = { type: 'agent', id: 'agent:worker', name: 'worker' } as const;
const INFRA = { type: 'system', id: 'orbital-infra' } as const;

export const ulid = (n: number): string => {
  let tail = '';
  let rest = n;
  for (let index = 0; index < 6; index += 1) {
    tail = (ALPHABET[rest % 32] ?? '0') + tail;
    rest = Math.floor(rest / 32);
  }
  return `01J8ZK5R4M2X6P9Q3V7W${tail}`;
};

export const at = (ms: number): string => new Date(Date.UTC(2026, 8, 17) + ms).toISOString();

export const ev = (n: number, ms: number, patch: Partial<Event> & Pick<Event, 'kind'>): Event => ({
  id: ulid(n),
  tenantId: 't',
  seq: n,
  ts: at(ms),
  sourceTs: at(ms),
  source: 'api',
  provenance: 'reported',
  runId: 'run-synth',
  actor: AGENT,
  attrs: {},
  prevHash: ZERO,
  hash: ZERO,
  ...patch,
});

// A 10k-event run: a grant, then tool calls with a world change every fifth event over 200 resources.
export function syntheticRun(count = 10_000, resources = 200): Event[] {
  const events: Event[] = [
    ev(0, 0, {
      kind: 'delegation.grant',
      actor: { type: 'human', id: 'human:pat' },
      authority: {
        principalId: 'human:pat',
        tokenRef: 'tok-0',
        scope: ['staging:*'],
        permissions: ['staging:files:read'],
      },
      attrs: { 'delegation.to': 'agent:worker', 'delegation.token.label': 'synthetic' },
    }),
  ];
  for (let n = 1; n < count; n += 1) {
    const ms = n * 10;
    const resource = `projects/p/volumes/vol-${String(Math.floor(n / 5) % resources)}`;
    if (n % 5 === 0) {
      events.push(
        ev(n, ms, {
          kind: 'world.change',
          source: 'world-hook',
          provenance: 'observed',
          actor: INFRA,
          target: {
            system: 'orbital',
            resource,
            environment: 'staging',
            operation: 'resizeVolume',
          },
          attrs: { 'world.field': 'sizeGb', 'world.before': n - 5, 'world.after': n },
        }),
      );
    } else {
      events.push(
        ev(n, ms, {
          kind: n % 2 === 0 ? 'tool.call' : 'tool.result',
          spanId: `s${String(Math.floor(n / 2))}`,
          target: { system: 'orbital', resource, operation: 'listVolumes' },
        }),
      );
    }
  }
  return events;
}
