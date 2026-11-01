import { decodeEvidence } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import { CANVAS_SESSION } from './__fixtures__/canvas-claims';
import { ApiError, type ApiClient } from './api';
import type { SessionCheckApi } from './session-api';
import { buildSessionCheck, sessionCheckSchema } from './session-check';
import { loadSessionCheck, toSessionCheckInput } from './sessions';

// The canvas sample as the API would return it after P-65.1 and P-72.1, built from the same stored events.
function apiCheck(): SessionCheckApi {
  const events = [...CANVAS_SESSION.events];
  const claims = events
    .filter((event) => event.kind === 'claim')
    .map((event) => ({
      id: event.id,
      predicate: String(event.attrs['claim.predicate']),
      modality: event.attrs['claim.modality'] as 'asserted' | 'hedged',
      subject: event.target ?? { system: 'unknown' },
    }));
  const verdictEvents = events.filter((event) => event.kind === 'verdict');
  const superseded = new Set(
    verdictEvents.map((event) => event.attrs['verdict.supersedes']).filter(Boolean),
  );
  const verdicts = verdictEvents
    .filter((event) => !superseded.has(event.id))
    .map((event): SessionCheckApi['verdicts'][number] => {
      const raw = event.attrs['verdict.trust'];
      const trust = raw === 'local' || raw === 'third-party' ? raw : undefined;
      return {
        claimId: String(event.attrs['verdict.claim_id']),
        outcome: event.attrs['verdict.outcome'] as 'holds' | 'contradicted' | 'no-witness',
        evidence: decodeEvidence(
          typeof event.attrs['verdict.evidence'] === 'string'
            ? event.attrs['verdict.evidence']
            : undefined,
        ),
        ...(trust === undefined ? {} : { trust }),
        checker: String(event.attrs['verdict.checker']),
        reason: String(event.attrs['verdict.reason']),
        eventId: event.id,
      };
    });
  const [effect] = CANVAS_SESSION.sideEffects;
  const world = events.find((event) => event.id === effect.worldEventId);
  return {
    session: {
      id: CANVAS_SESSION.session.id,
      window: { from: '2026-10-25T08:30:00.000Z', to: '2026-10-25T09:40:00.000Z' },
      messages: 7,
      agent: 'coding-agent',
      startedAt: CANVAS_SESSION.session.startedAt,
      endedAt: CANVAS_SESSION.session.endedAt,
    },
    claims,
    verdicts,
    sideEffects: {
      effects: [
        {
          worldEventId: effect.worldEventId,
          toolNodeId: `tool:${effect.toolCallId}`,
          toolEventIds: [effect.toolCallId],
          confidence: 'exact',
          reason: 'request',
          system: world?.target?.system ?? 'stripe',
          summary: world?.summary ?? '',
        },
      ],
      weak: [],
      covered: [],
    },
    witnesses: [
      { system: 'github', trust: 'third-party', events: 11 },
      { system: 'neon', trust: 'third-party', events: 6 },
      { system: 'vercel', trust: 'third-party', events: 3 },
      { system: 'stripe', trust: 'third-party', events: 2 },
      { system: 'git', trust: 'local', events: 3 },
      { system: 'git', trust: 'third-party', events: 1 },
    ],
    events,
    appended: 0,
  };
}

const client =
  (check: SessionCheckApi | ApiError): (() => ApiClient) =>
  () =>
    ({
      getSessionCheck: () =>
        check instanceof ApiError ? Promise.reject(check) : Promise.resolve(check),
    }) as unknown as ApiClient;

describe('toSessionCheckInput', () => {
  it('maps the API response to the page payload: one roster entry per system, the missing ones named', () => {
    const input = toSessionCheckInput(apiCheck());
    expect(input.session).toEqual({
      id: 'session-canvas',
      agent: 'coding-agent',
      startedAt: CANVAS_SESSION.session.startedAt,
      endedAt: CANVAS_SESSION.session.endedAt,
      sample: false,
    });
    expect(input.sideEffects).toEqual([{ ...CANVAS_SESSION.sideEffects[0], via: 'request' }]);
    expect(input.witnesses).toEqual([
      { state: 'connected', system: 'github', trust: 'third-party', observed: 11 },
      { state: 'connected', system: 'neon', trust: 'third-party', observed: 6 },
      { state: 'connected', system: 'vercel', trust: 'third-party', observed: 3 },
      { state: 'connected', system: 'stripe', trust: 'third-party', observed: 2 },
      { state: 'connected', system: 'git', trust: 'third-party', observed: 1 },
      { state: 'missing', system: 'secrets' },
    ]);
    const verdictEvents = input.events.filter((event) => event.kind === 'verdict');
    expect(verdictEvents.some((event) => event.attrs['verdict.supersedes'] !== undefined)).toBe(
      true,
    );
  });

  it('merges a system seen at one trust twice, and reads aliases before calling a system missing', () => {
    const api = apiCheck();
    const twice = toSessionCheckInput({
      ...api,
      witnesses: [
        ...api.witnesses.filter((w) => w.system !== 'git'),
        { system: 'git', trust: 'local', events: 2 },
        { system: 'git', trust: 'local', events: 3 },
      ],
      claims: [
        ...api.claims,
        { id: 'c-ci', predicate: 'ci.passed', modality: 'asserted', subject: { system: 'ci' } },
      ],
    });
    expect(twice.witnesses.find((w) => w.system === 'git')).toEqual({
      state: 'connected',
      system: 'git',
      trust: 'local',
      observed: 5,
    });
    expect(twice.witnesses.filter((w) => w.state === 'missing').map((w) => w.system)).toEqual([
      'secrets',
    ]);
    const lowerLater = toSessionCheckInput({
      ...api,
      witnesses: [
        ...api.witnesses.filter((w) => w.system !== 'git'),
        { system: 'git', trust: 'third-party', events: 1 },
        { system: 'git', trust: 'local', events: 2 },
      ],
    });
    expect(lowerLater.witnesses.find((w) => w.system === 'git')).toEqual({
      state: 'connected',
      system: 'git',
      trust: 'third-party',
      observed: 1,
    });
  });

  it('refuses, loudly, a side effect whose tool node has no reported call; the agent reads Coding agent', () => {
    const api = apiCheck();
    const { agent: _agent, ...session } = api.session;
    expect(toSessionCheckInput({ ...api, session }).session.agent).toBe('coding-agent');
    const effect = api.sideEffects.effects[0]!;
    expect(() =>
      toSessionCheckInput({
        ...api,
        sideEffects: {
          ...api.sideEffects,
          effects: [{ ...effect, toolEventIds: ['01JBCM00000000000000000099'] }],
        },
      }),
    ).toThrow(/not a reported tool call/);
    expect(() =>
      toSessionCheckInput({
        ...api,
        sideEffects: { ...api.sideEffects, effects: [{ ...effect, toolEventIds: [] }] },
      }),
    ).toThrow();
  });

  it('shows a session with no recorded verdict as not checked', () => {
    const api = apiCheck();
    const check = buildSessionCheck(
      toSessionCheckInput({
        ...api,
        verdicts: [],
        events: api.events.filter((event) => event.kind !== 'verdict'),
      }),
    );
    expect(check.counts.pending).toBe(check.claims.length);
    expect(check.counts.claims).toBe(0);
  });
});

describe('loadSessionCheck from the API', () => {
  it('builds the same check from the API as from the sample, marked as not a sample', async () => {
    const fromApi = await loadSessionCheck('any-id', client(apiCheck()));
    const sample = await loadSessionCheck('session-canvas', client(new ApiError(500, '/x', 'no')));
    expect(sessionCheckSchema.parse(fromApi)).toEqual(fromApi);
    expect(fromApi?.counts).toEqual(sample?.counts);
    expect(fromApi?.session.sample).toBe(false);
    expect(sample?.session.sample).toBe(true);
  });

  it('answers undefined for a 404 and rethrows anything else', async () => {
    expect(await loadSessionCheck('gone', client(new ApiError(404, '/x', 'gone')))).toBeUndefined();
    await expect(loadSessionCheck('down', client(new ApiError(503, '/x', 'down')))).rejects.toThrow(
      'down',
    );
  });
});
