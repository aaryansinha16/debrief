import type { Event } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import {
  RESERVED_SOURCE_ID,
  dedupeById,
  isSessionEvent,
  messageSpan,
  sessionWindow,
  verdictSourceId,
  witnessesOf,
} from './session-check.js';

const ZERO = '0'.repeat(64);
const event = (
  patch: Partial<Event> & Pick<Event, 'id' | 'kind' | 'provenance' | 'sourceTs'>,
): Event => ({
  tenantId: 't1',
  seq: 0,
  ts: patch.sourceTs,
  source: 'api',
  runId: 's1',
  actor: { type: 'agent', id: 'a' },
  attrs: {},
  prevHash: ZERO,
  hash: ZERO,
  ...patch,
});

describe('session-check helpers', () => {
  it('spans the reported events, padded, and has no window without them', () => {
    const said = event({
      id: 'a',
      kind: 'agent.message',
      provenance: 'reported',
      sourceTs: '2026-10-25T09:00:00.000Z',
    });
    const later = event({
      id: 'b',
      kind: 'tool.call',
      provenance: 'reported',
      sourceTs: '2026-10-25T09:10:00.000+00:00',
    });
    const seen = event({
      id: 'c',
      kind: 'world.change',
      provenance: 'observed',
      sourceTs: '2026-10-25T11:00:00.000Z',
    });
    const odd = event({ id: 'd', kind: 'agent.message', provenance: 'reported', sourceTs: 'nope' });
    const margins = { beforeMs: 60_000, afterMs: 600_000, maxSpanMs: 86_400_000 };
    expect(sessionWindow([seen, later, said, odd], margins)).toEqual({
      from: '2026-10-25T08:59:00.000Z',
      to: '2026-10-25T09:10:00.000Z',
    });
    expect(sessionWindow([seen, odd], margins)).toBeUndefined();
    const farDated = event({
      id: 'e',
      kind: 'tool.call',
      provenance: 'reported',
      sourceTs: '2027-01-01T00:00:00.000Z',
    });
    expect(sessionWindow([said, farDated], margins)).toEqual({
      from: '2026-10-25T08:59:00.000Z',
      to: '2026-10-25T09:10:00.000Z',
    });
    const lastWord = event({
      id: 'f',
      kind: 'agent.message',
      provenance: 'reported',
      sourceTs: '2026-10-27T09:00:00.000Z',
    });
    expect(sessionWindow([said, lastWord], { ...margins, maxSpanMs: 3_600_000 })).toEqual({
      from: '2026-10-25T08:59:00.000Z',
      to: '2026-10-25T09:59:00.000Z',
    });
    expect(messageSpan([seen, later])).toBeUndefined();
    expect(isSessionEvent(said)).toBe(true);
    expect(isSessionEvent(later)).toBe(false);
  });

  it('keys a verdict by everything that makes it distinct, and dedupes events by id', () => {
    const base = {
      claimId: 'c1',
      checker: 'tests.passed@1',
      outcome: 'holds' as const,
      evidence: ['e1', 'e2'],
      reason: 'r',
    };
    const local = verdictSourceId({ ...base, trust: 'local' });
    expect(local).toMatch(/^verdict:[0-9a-f]{64}$/);
    expect(verdictSourceId({ ...base, trust: 'local' })).toBe(local);
    expect(verdictSourceId({ ...base, supersedes: 'v0' })).not.toBe(local);
    expect(verdictSourceId({ ...base, evidence: ['e2', 'e1'] })).not.toBe(local);
    const many = {
      ...base,
      evidence: Array.from({ length: 100 }, (_, n) => `01JBV${String(n).padStart(21, '0')}`),
    };
    expect(verdictSourceId(many).length).toBeLessThan(80);
    expect(RESERVED_SOURCE_ID.test(local)).toBe(true);
    expect(RESERVED_SOURCE_ID.test('github:push:x')).toBe(false);
    const a = event({ id: 'a', kind: 'agent.message', provenance: 'reported', sourceTs: 't' });
    expect(dedupeById([a, { ...a, seq: 9 }, a]).map((e) => e.seq)).toEqual([0]);
  });

  it('summarises witnesses by system and trust, unknown trust counting as local', () => {
    const witness = (id: string, system: string, trust?: string): Event =>
      event({
        id,
        kind: 'world.change',
        provenance: 'observed',
        sourceTs: 't',
        target: { system },
        attrs: trust === undefined ? {} : { 'witness.trust': trust },
      });
    const { target: _t, ...targetless } = witness('x', 'x', 'third-party');
    expect(
      witnessesOf([
        witness('1', 'github', 'third-party'),
        witness('2', 'github', 'third-party'),
        witness('3', 'git', 'local'),
        witness('4', 'git'),
        targetless,
      ]),
    ).toEqual([
      { system: 'git', trust: 'local', events: 2 },
      { system: 'github', trust: 'third-party', events: 2 },
      { system: 'unknown', trust: 'third-party', events: 1 },
    ]);
  });
});
