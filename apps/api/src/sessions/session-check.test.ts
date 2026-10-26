import type { Event } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import {
  dedupeById,
  isSessionEvent,
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
    expect(sessionWindow([seen, later, said, odd], { beforeMs: 60_000, afterMs: 600_000 })).toEqual(
      {
        from: '2026-10-25T08:59:00.000Z',
        to: '2026-10-25T09:20:00.000Z',
      },
    );
    expect(sessionWindow([seen, odd], { beforeMs: 0, afterMs: 0 })).toBeUndefined();
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
    expect(verdictSourceId({ ...base, trust: 'local' })).toBe(
      'verdict:c1:tests.passed@1:holds:local:e1,e2:',
    );
    expect(verdictSourceId({ ...base, supersedes: 'v0' })).toBe(
      'verdict:c1:tests.passed@1:holds::e1,e2:v0',
    );
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
