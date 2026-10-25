import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';

import { type Event, eventInputSchema, eventSchema } from './event.js';

const CLAIM_ID = '01JB2W6Q8R0S1T2V3W4X5Y6Z7A';
const READ_ID = '01JB2W6Q8R0S1T2V3W4X5Y6Z7B';
const CHANGE_ID = '01JB2W6Q8R0S1T2V3W4X5Y6Z7C';

const base = {
  tenantId: 'tenant-a',
  seq: 0,
  ts: '2026-10-26T00:00:00.000Z',
  sourceTs: '2026-10-26T00:00:00.000Z',
  runId: '4bf92f3577b34da6a3ce929d0e0e4736',
  prevHash: '0'.repeat(64),
  hash: 'ab'.repeat(32),
} as const;

const worldRead: Event = {
  ...base,
  id: READ_ID,
  source: 'world-hook',
  provenance: 'observed',
  kind: 'world.read',
  actor: { type: 'system', id: 'orbital-infra' },
  target: {
    system: 'orbital',
    resource: 'projects/nova/db/users',
    environment: 'production',
    operation: 'select',
  },
  attrs: { 'witness.trust': 'third-party', 'world.rows': 12 },
};

const claim: Event = {
  ...base,
  id: CLAIM_ID,
  source: 'api',
  provenance: 'derived',
  kind: 'claim',
  actor: { type: 'system', id: 'debrief-claims' },
  target: { system: 'orbital', resource: 'projects/nova/ci', environment: 'staging' },
  attrs: {
    'claim.text': 'All 142 tests pass.',
    'claim.span.message_id': 'msg-0001',
    'claim.span.start': 120,
    'claim.span.end': 139,
    'claim.modality': 'asserted',
    'claim.predicate': 'tests.passed',
    'claim.param.passed': 142,
  },
};

const verdict: Event = {
  ...base,
  id: '01JB2W6Q8R0S1T2V3W4X5Y6Z7D',
  source: 'api',
  provenance: 'derived',
  kind: 'verdict',
  actor: { type: 'system', id: 'debrief-verdict' },
  attrs: {
    'verdict.claim_id': CLAIM_ID,
    'verdict.outcome': 'contradicted',
    'verdict.evidence': `${READ_ID},${CHANGE_ID}`,
    'verdict.trust': 'third-party',
    'verdict.checker': 'tests.passed@1',
    'verdict.reason': 'CI recorded 139 passed and 3 skipped',
  },
};

const input = ({ seq: _seq, prevHash: _prev, hash: _hash, ...rest }: Event): unknown => rest;

const messages = (value: unknown, schema: ZodType = eventSchema): string[] => {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe('provenance pairing (D-083)', () => {
  it.each([worldRead, claim, verdict])('accepts a well-formed $kind event', (event) => {
    expect(messages(event)).toEqual([]);
    expect(messages(input(event), eventInputSchema)).toEqual([]);
  });

  it.each([
    [claim, 'reported'],
    [claim, 'observed'],
    [verdict, 'reported'],
    [verdict, 'observed'],
  ] as const)('rejects a $kind event that is %s', (event, provenance) => {
    expect(messages({ ...event, provenance })).toContain(`${event.kind} events are derived`);
  });

  it('rejects derived provenance on any other kind', () => {
    expect(messages({ ...claim, kind: 'tool.call', target: undefined, attrs: {} })).toEqual([
      'only claim and verdict events are derived',
    ]);
  });

  it.each(['reported', 'derived'] as const)('rejects a world.read that is %s', (provenance) => {
    expect(messages({ ...worldRead, provenance, attrs: {} })).toContain(
      'world.read events are observed',
    );
  });

  it('applies the pairing to input events too', () => {
    expect(messages(input({ ...claim, provenance: 'reported' }), eventInputSchema)).toContain(
      'claim events are derived',
    );
  });
});

describe('witness trust (D-083)', () => {
  const untrusted = { ...worldRead, attrs: { 'world.rows': 12 } };

  it('requires it on observed events at ingest', () => {
    expect(messages(input(untrusted), eventInputSchema)).toEqual([
      'observed events carry witness.trust (local | third-party)',
    ]);
  });

  it('still parses observed events stored before it existed', () => {
    expect(messages(untrusted)).toEqual([]);
  });

  it.each(['local', 'third-party'])('accepts %s', (trust) => {
    const event = { ...worldRead, attrs: { 'witness.trust': trust } };
    expect(messages(input(event), eventInputSchema)).toEqual([]);
  });

  it.each(['first-party', 'LOCAL', true, 1])('rejects the value %j', (trust) => {
    expect(messages({ ...worldRead, attrs: { 'witness.trust': trust } })).toEqual([
      'witness.trust is local or third-party',
    ]);
  });

  it.each([
    ['reported', { ...worldRead, kind: 'world.change', provenance: 'reported' }],
    ['derived', { ...claim, attrs: { ...claim.attrs, 'witness.trust': 'local' } }],
  ] as const)('rejects it on a %s event', (_label, event) => {
    expect(messages(event)).toEqual(['witness.trust belongs on observed events only']);
  });
});
