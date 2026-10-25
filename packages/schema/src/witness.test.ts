import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';

import { type Event, eventInputSchema, eventSchema } from './event.js';
import { decodeEvidence, encodeEvidence } from './verdict.js';

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

  it.each(['first-party', 'LOCAL', true, 1])('rejects the value %j at ingest', (trust) => {
    const event = { ...worldRead, attrs: { 'witness.trust': trust } } as Event;
    expect(messages(input(event), eventInputSchema)).toEqual([
      'witness.trust is local or third-party',
    ]);
  });

  const misplaced = [
    ['reported', { ...worldRead, kind: 'world.change', provenance: 'reported' }],
    ['derived', { ...claim, attrs: { ...claim.attrs, 'witness.trust': 'local' } }],
  ] as const;

  it.each(misplaced)('rejects it on a %s event at ingest', (_label, event) => {
    expect(messages(input(event as Event), eventInputSchema)).toEqual([
      'witness.trust belongs on observed events only',
    ]);
  });

  it.each(misplaced)('still reads a stored %s event that carries it', (_label, event) => {
    expect(messages(event)).toEqual([]);
    expect(messages({ ...worldRead, attrs: { 'witness.trust': 'first-party' } })).toEqual([]);
  });
});

describe('reserved namespaces at ingest (D-083)', () => {
  const toolCall = {
    ...base,
    id: '01JB2W6Q8R0S1T2V3W4X5Y6Z7F',
    source: 'api',
    provenance: 'reported',
    kind: 'tool.call',
    actor: { type: 'agent', id: 'coding-agent' },
  } as const;

  it.each([
    ['claim.text', 'claim'],
    ['verdict.outcome', 'verdict'],
  ])('rejects %s on another kind', (name, owner) => {
    const event: Event = { ...toolCall, attrs: { [name]: 'holds' } };
    expect(messages(input(event), eventInputSchema)).toEqual([
      `${name} belongs on ${owner} events only`,
    ]);
    expect(messages(event)).toEqual([]);
  });

  it('rejects verdict attributes on a claim', () => {
    const event = { ...claim, attrs: { ...claim.attrs, 'verdict.outcome': 'holds' } };
    expect(messages(input(event), eventInputSchema)).toEqual([
      'verdict.outcome belongs on verdict events only',
    ]);
  });
});

describe('claim events (D-083)', () => {
  const withAttrs = (attrs: Record<string, unknown>): unknown => ({
    ...claim,
    attrs: { ...claim.attrs, ...attrs },
  });
  const without = (key: string): unknown => {
    const { [key]: _drop, ...attrs } = claim.attrs;
    return { ...claim, attrs };
  };
  const paths = (value: unknown): string[] => {
    const result = eventSchema.safeParse(value);
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join('/'));
  };

  it.each([
    'claim.text',
    'claim.span.message_id',
    'claim.span.start',
    'claim.span.end',
    'claim.modality',
    'claim.predicate',
  ])('rejects a claim without %s', (key) => {
    expect(paths(without(key))).toEqual([`attrs/${key}`]);
  });

  it('rejects a span that does not cover exactly the text', () => {
    expect(messages(withAttrs({ 'claim.span.end': 140 }))).toEqual([
      'the span must cover exactly the claim text',
    ]);
  });

  it.each([
    ['claim.text', ''],
    ['claim.text', 'x'.repeat(1001)],
    ['claim.span.start', -1],
    ['claim.span.start', 1.5],
    ['claim.span.message_id', ''],
    ['claim.modality', 'certain'],
    ['claim.predicate', 'Tests.Passed'],
    ['claim.predicate', 'tests'],
    ['claim.predicate', 'tests..passed'],
  ])('rejects %s = %j', (key, value) => {
    expect(paths(withAttrs({ [key]: value }))).toContain(`attrs/${key}`);
  });

  it('accepts hedged and unchecked claims, the longest text and other namespaces', () => {
    const text = 'x'.repeat(1000);
    expect(
      messages(
        withAttrs({
          'claim.text': text,
          'claim.span.start': 0,
          'claim.span.end': text.length,
          'claim.modality': 'hedged',
          'claim.predicate': 'unchecked',
          'debrief.redaction.v': 1,
        }),
      ),
    ).toEqual([]);
  });

  it.each(['claim.confidence', 'claim.param.Passed', 'claim.param.'])(
    'rejects the unknown key %s',
    (key) => {
      expect(messages(withAttrs({ [key]: 1 }))).toEqual([`unknown claim attribute ${key}`]);
    },
  );

  it('rejects a claim without a subject', () => {
    expect(messages({ ...claim, target: undefined })).toEqual([
      'a claim names its subject in target',
    ]);
  });
});

describe('verdict events (D-083)', () => {
  const ids = (count: number): string[] =>
    Array.from({ length: count }, (_, n) => `01JB2W6Q8R0S1T2V3W4X5Y6${String(n).padStart(3, '0')}`);
  const withAttrs = (attrs: Record<string, unknown>): unknown => {
    const merged: Record<string, unknown> = { ...verdict.attrs, ...attrs };
    for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
    return { ...verdict, attrs: merged };
  };

  it.each(['holds', 'contradicted'])('rejects a %s verdict without evidence ids', (outcome) => {
    expect(
      messages(withAttrs({ 'verdict.outcome': outcome, 'verdict.evidence': undefined })),
    ).toEqual([`a ${outcome} verdict cites evidence`]);
  });

  it.each(['holds', 'contradicted'])('rejects a %s verdict without trust', (outcome) => {
    expect(messages(withAttrs({ 'verdict.outcome': outcome, 'verdict.trust': undefined }))).toEqual(
      [`a ${outcome} verdict records the trust behind it`],
    );
  });

  it('accepts a no-witness verdict with or without evidence, never with trust', () => {
    const noWitness = { 'verdict.outcome': 'no-witness', 'verdict.trust': undefined };
    expect(messages(withAttrs({ ...noWitness, 'verdict.evidence': undefined }))).toEqual([]);
    expect(messages(withAttrs(noWitness))).toEqual([]);
    expect(messages(withAttrs({ ...noWitness, 'verdict.trust': 'local' }))).toEqual([
      'a no-witness verdict has no trust',
    ]);
  });

  it('accepts local trust, a supersedes id and the largest evidence set', () => {
    expect(
      messages(
        withAttrs({
          'verdict.outcome': 'holds',
          'verdict.trust': 'local',
          'verdict.evidence': ids(100).join(','),
          'verdict.supersedes': '01JB2W6Q8R0S1T2V3W4X5Y6Z7E',
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    ['unsorted', [READ_ID, CHANGE_ID].reverse().join(',')],
    ['duplicated', `${READ_ID},${READ_ID}`],
  ])('rejects %s evidence', (_label, evidence) => {
    expect(messages(withAttrs({ 'verdict.evidence': evidence }))).toEqual([
      'evidence ids are sorted and unique',
    ]);
  });

  it.each([
    ['verdict.evidence', ids(101).join(',')],
    ['verdict.evidence', ''],
    ['verdict.evidence', `${READ_ID}, ${CHANGE_ID}`],
    ['verdict.claim_id', 'claim-1'],
    ['verdict.supersedes', 'verdict-1'],
    ['verdict.outcome', 'partly'],
    ['verdict.trust', 'first-party'],
    ['verdict.checker', 'tests.passed'],
    ['verdict.checker', 'tests.passed@0'],
    ['verdict.checker', 'Tests@1'],
    ['verdict.reason', ''],
    ['verdict.reason', 'x'.repeat(281)],
  ])('rejects %s = %j', (key, value) => {
    const result = eventSchema.safeParse(withAttrs({ [key]: value }));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('/'))).toContain(`attrs/${key}`);
  });

  it('rejects unknown verdict keys', () => {
    expect(messages(withAttrs({ 'verdict.confidence': 0.9 }))).toEqual([
      'unknown verdict attribute verdict.confidence',
    ]);
  });
});

describe('evidence encoding', () => {
  it('sorts, dedupes and round-trips', () => {
    const encoded = encodeEvidence([CHANGE_ID, READ_ID, CHANGE_ID]);
    expect(encoded).toBe(`${READ_ID},${CHANGE_ID}`);
    expect(decodeEvidence(encoded)).toEqual([READ_ID, CHANGE_ID]);
  });

  it('encodes no evidence as an absent attribute', () => {
    expect(encodeEvidence([])).toBeUndefined();
    expect(decodeEvidence(undefined)).toEqual([]);
  });
});
