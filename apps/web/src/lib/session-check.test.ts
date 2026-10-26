import type { Event } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import { all, claims, input, SESSION, at, ci, deploy, judged } from './__fixtures__/mixed-session';
import {
  stored,
  type Draft,
  claimDraft,
  ulidOf,
  observedDraft,
  toolCallDraft,
} from './__fixtures__/session-events';
import {
  buildSessionCheck,
  sessionCheckSchema,
  checkCountsSchema,
  claimStateSchema,
} from './session-check';

describe('buildSessionCheck', () => {
  it('puts contradictions first, then third-party holds, local holds, no witness, unchecked, hedged', () => {
    const check = buildSessionCheck(input(all));
    expect(sessionCheckSchema.parse(check)).toEqual(check);
    expect(check.claims.map((claim) => [claim.text, claim.state])).toEqual([
      ['All 9 tests pass.', 'contradicted'],
      ['Deploy is live.', 'holds'],
      ['Migrated staging.', 'holds'],
      ['Removed the flag.', 'holds'],
      ['Rotated the key.', 'no-witness'],
      ['Opened PR #4.', 'pending'],
      ['It should stay green.', 'hedged'],
    ]);
    expect(check.counts).toEqual({
      claims: 5,
      holds: 3,
      contradicted: 1,
      noWitness: 1,
      local: 1,
      pending: 1,
      hedged: 1,
    });
  });

  it('joins each verdict to the observed events it cites, with their trust', () => {
    const [broken, , , local, unseen] = buildSessionCheck(input(all)).claims;
    expect(broken?.verdict?.evidence).toEqual([
      expect.objectContaining({ id: ci, summary: 'witness record 3', trust: 'third-party' }),
    ]);
    expect(broken?.params).toEqual({ passed: 9 });
    expect(local?.verdict).toMatchObject({ trust: 'local', checker: 'tests.passed@1' });
    expect(local?.verdict?.evidence[0]?.trust).toBe('local');
    expect(unseen).toMatchObject({ witness: 'missing', verdict: { evidence: [] } });
    expect(broken?.witness).toBe('connected');
  });

  it('never shows an event that is not observed as evidence, nor an old one without trust as third-party', () => {
    const events = input(all).events.map((event): Event => {
      if (event.id === ci) return { ...event, attrs: {} };
      if (event.id === deploy) return { ...event, provenance: 'reported' };
      return event;
    });
    const check = buildSessionCheck({ ...input(all), events });
    const late = check.claims.find((claim) => claim.text === 'Deploy is live.');
    expect(late?.verdict?.evidence).toEqual([]);
    expect(check.claims[0]?.verdict?.evidence[0]?.trust).toBe('local');
  });

  it('shows the latest verdict and keeps the superseded one as history, in any order and repeated', () => {
    const payload = input(all);
    const once = buildSessionCheck(payload);
    const again = buildSessionCheck({
      ...payload,
      events: [...payload.events].reverse().concat(payload.events),
    });
    expect(again).toEqual(once);
    const late = once.claims.find((claim) => claim.text === 'Deploy is live.');
    expect(late?.verdict).toMatchObject({ outcome: 'holds', supersedes: ulidOf('V', 1) });
    expect(late?.history.map((verdict) => verdict.outcome)).toEqual(['no-witness']);
  });

  it('still picks one verdict when supersedes run in a circle the payload schema would refuse', () => {
    const loop = [
      judged(8, { claimId: claims.held.id, outcome: 'no-witness', supersedes: ulidOf('V', 9) }),
      judged(9, { claimId: claims.held.id, outcome: 'no-witness', supersedes: ulidOf('V', 8) }),
    ];
    const events = stored([claims.held, ...loop]);
    const [claim] = buildSessionCheck({ ...input([]), events }).claims;
    expect(claim?.verdict?.id).toBe(ulidOf('V', 9));
    expect(claim?.history.map((verdict) => verdict.id)).toEqual([ulidOf('V', 8)]);
  });

  it('keeps a hedged claim and its verdict on the page and out of every count', () => {
    const hedged = buildSessionCheck(input(all)).claims.find(
      (claim) => claim.modality === 'hedged',
    );
    expect(hedged).toMatchObject({ modality: 'hedged', state: 'hedged' });
    expect(hedged?.verdict?.outcome).toBe('no-witness');
  });

  it('takes a claim without a subject to be about an unknown system', () => {
    const events = stored([claims.held]).map((event): Event => {
      const bare = { ...event };
      delete bare.target;
      return bare;
    });
    const [claim] = buildSessionCheck({ ...input([]), events }).claims;
    expect(claim).toMatchObject({
      subject: { system: 'unknown' },
      witness: 'missing',
      history: [],
    });
  });

  it('orders claims said at the same moment by id', () => {
    const twin = (n: number): Draft =>
      claimDraft(ulidOf('C', n), SESSION, {
        text: `Claim ${String(n)}.`,
        messageId: `msg-${String(n)}`,
        saidAt: at('10:00:00'),
        predicate: 'unchecked',
        subject: { system: 'github' },
      });
    const check = buildSessionCheck(input([twin(9), twin(8)]));
    expect(check.claims.map((claim) => claim.text)).toEqual(['Claim 8.', 'Claim 9.']);
  });
});

describe('the session check view model', () => {
  it('gives a claim one of five states and counts in whole numbers', () => {
    expect(claimStateSchema.options).toEqual([
      'contradicted',
      'holds',
      'no-witness',
      'pending',
      'hedged',
    ]);
    const counts = {
      claims: 7,
      holds: 4,
      contradicted: 2,
      noWitness: 1,
      local: 1,
      pending: 0,
      hedged: 0,
    };
    expect(checkCountsSchema.parse(counts)).toEqual(counts);
    expect(checkCountsSchema.safeParse({ ...counts, holds: -1 }).success).toBe(false);
    expect(checkCountsSchema.safeParse({ ...counts, local: 0.5 }).success).toBe(false);
  });
});

describe('the integrity ring', () => {
  it('gives every scored claim an equal arc: holds, then contradicted, then no witness', () => {
    const check = buildSessionCheck(input(all));
    expect(
      check.ring.map((arc) => [
        check.claims.find((claim) => claim.id === arc.claimId)?.text,
        arc.outcome,
        arc.local,
        arc.from,
        arc.to,
      ]),
    ).toEqual([
      ['Deploy is live.', 'holds', false, 0, 0.2],
      ['Migrated staging.', 'holds', false, 0.2, 0.4],
      ['Removed the flag.', 'holds', true, 0.4, 0.6],
      ['All 9 tests pass.', 'contradicted', false, 0.6, 0.8],
      ['Rotated the key.', 'no-witness', false, 0.8, 1],
    ]);
    expect(buildSessionCheck(input([claims.waiting, claims.hedged])).ring).toEqual([]);
  });
});

describe('side effects', () => {
  it('counts exact and strong side effects, lists weak ones apart, in the order the world saw them', () => {
    const change = (n: number, time: string): Draft =>
      observedDraft(ulidOf('W', n), {
        at: at(time),
        target: { system: 'stripe', operation: 'delete' },
        trust: 'third-party',
        summary: `change ${String(n)}`,
      });
    const call = toolCallDraft(ulidOf('T', 1), SESSION, at('10:10:00'), 'hooks.remove');
    const bare = { ...toolCallDraft(ulidOf('T', 2), SESSION, at('10:11:00'), 'x'), attrs: {} };
    const unnamed = {
      ...bare,
      id: ulidOf('T', 3),
      kind: 'mcp.request' as const,
      target: undefined,
    };
    const drafts = [change(7, '10:12:00'), change(8, '10:11:00'), change(9, '10:12:00')];
    const payload = {
      ...input([...drafts, call, bare, unnamed]),
      sideEffects: [
        {
          worldEventId: ulidOf('W', 7),
          toolCallId: call.id,
          confidence: 'exact' as const,
          via: 'request id',
        },
        { worldEventId: ulidOf('W', 8), toolCallId: bare.id, confidence: 'strong' as const },
        { worldEventId: ulidOf('W', 9), toolCallId: unnamed.id, confidence: 'weak' as const },
        { worldEventId: ulidOf('W', 6), toolCallId: call.id, confidence: 'exact' as const },
      ],
    };
    const { counted, weak } = buildSessionCheck(payload).sideEffects;
    expect(
      counted.map((effect) => [effect.world.summary, effect.toolCall.name, effect.via]),
    ).toEqual([
      ['change 8', 'x', undefined],
      ['change 7', 'hooks.remove', 'request id'],
    ]);
    expect(weak.map((effect) => [effect.world.summary, effect.toolCall.name])).toEqual([
      ['change 9', 'tool call'],
    ]);
    expect(counted[0]?.world).toMatchObject({ trust: 'third-party', kind: 'world.change' });
  });

  it('keeps one link per world event, the surest, whatever order or repeats it comes in', () => {
    const change = observedDraft(ulidOf('W', 7), {
      at: at('10:12:00'),
      target: { system: 'stripe', operation: 'delete' },
      trust: 'third-party',
      summary: 'change 7',
    });
    const calls = [1, 2].map((n) =>
      toolCallDraft(ulidOf('T', n), SESSION, at('10:10:00'), `c${String(n)}`),
    );
    const link = (n: number, confidence: 'exact' | 'strong' | 'weak', via?: string) => ({
      worldEventId: change.id,
      toolCallId: ulidOf('T', n),
      confidence,
      ...(via === undefined ? {} : { via }),
    });
    const links = [link(2, 'weak'), link(2, 'strong', 'key'), link(1, 'strong'), link(2, 'strong')];
    const payload = { ...input([change, ...calls]), sideEffects: links };
    const once = buildSessionCheck(payload).sideEffects;
    expect(once.weak).toEqual([]);
    expect(
      once.counted.map((effect) => [effect.toolCall.name, effect.confidence, effect.via]),
    ).toEqual([['c1', 'strong', undefined]]);
    for (const order of [[...links].reverse(), [...links, ...links]]) {
      expect(buildSessionCheck({ ...payload, sideEffects: order }).sideEffects).toEqual(once);
    }
    const viaOnly = [link(2, 'strong', 'key'), link(2, 'strong')];
    const picked = buildSessionCheck({ ...payload, sideEffects: viaOnly }).sideEffects.counted[0];
    expect(picked?.via).toBeUndefined();
  });
});

describe('the witness roster', () => {
  it('lists third-party witnesses, then local ones, then the missing, each by system in any order', () => {
    const roster = [
      { state: 'missing' as const, system: 'secrets' },
      { state: 'connected' as const, system: 'git', trust: 'local' as const, observed: 2 },
      {
        state: 'connected' as const,
        system: 'neon',
        trust: 'third-party' as const,
        observed: 6,
      },
      {
        state: 'connected' as const,
        system: 'github',
        trust: 'third-party' as const,
        observed: 11,
      },
    ];
    const order = (witnesses: typeof roster): string[] =>
      buildSessionCheck({ ...input([]), witnesses }).witnesses.map((witness) => witness.system);
    expect(order(roster)).toEqual(['github', 'neon', 'git', 'secrets']);
    expect(order([...roster].reverse())).toEqual(order(roster));
  });
});
