import { buildGraph, correlateWorld } from '@debrief/reconstruct';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import golden from '../__golden__/side-effects.json' with { type: 'json' };
import { claim, ist, ulid, witness } from './__fixtures__/index.js';
import {
  SESSION,
  SIDE_EFFECTS_WINDOW,
  sideEffectsSession,
  toolPair,
} from './__fixtures__/side-effects.js';
import { claimsOf } from './claims.js';
import { covers, sideEffects } from './side-effects.js';

const events = sideEffectsSession;
const graph = buildGraph(events, { runId: SESSION });
const claims = claimsOf(events);
const result = sideEffects(claims, events, graph, SIDE_EFFECTS_WINDOW);
const find = (n: number) => events.find((e) => e.id === ulid(n))!;

describe('sideEffects', () => {
  it('matches the golden', () => {
    expect(result).toEqual(golden);
  });

  it('surfaces the Stripe deletion exact through its request id and the S3 deletion strong through its key', () => {
    expect(result.effects.map((e) => [e.system, e.confidence, e.reason])).toEqual([
      ['stripe', 'exact', 'request'],
      ['aws', 'strong', 'access-key'],
    ]);
    const [stripe, aws] = result.effects;
    expect(stripe).toMatchObject({
      worldEventId: ulid(30),
      toolNodeId: `tool:${ulid(20)}`,
      toolEventIds: [ulid(20), ulid(21)],
      summary: 'webhook endpoint we_1Q9f3a deleted (livemode)',
    });
    expect(aws?.toolEventIds).toEqual([ulid(22), ulid(23)]);
  });

  it('files the covered PR apart, lists weak links apart, and blames no human, read, git state or operation twin', () => {
    expect(result.covered).toEqual([
      expect.objectContaining({ worldEventId: ulid(33), claimId: ulid(1), confidence: 'exact' }),
    ]);
    expect(result.weak.map((w) => [w.worldEventId, w.confidence, w.reason])).toEqual([
      [ulid(38), 'weak', 'operation'],
      [ulid(34), 'weak', 'system'],
    ]);
    const listed = new Set(
      [...result.effects, ...result.weak, ...result.covered].map((e) => e.worldEventId),
    );
    for (const n of [9, 10, 32, 35, 36, 37]) expect(listed.has(ulid(n)), String(n)).toBe(false);
  });

  it('covers a change only with an asserted claim on exactly its system, environment and resource', () => {
    const [pr, hedged, exports] = claims;
    const s3 = find(31);
    expect(covers(pr!, find(33))).toBe(true);
    expect(covers(hedged!, find(30))).toBe(false);
    expect(covers(exports!, s3)).toBe(false);
    expect(covers({ ...exports!, subject: { system: 'aws', resource: 'exports-prod' } }, s3)).toBe(
      true,
    );
    expect(covers({ ...exports!, subject: { system: 'aws', environment: 'production' } }, s3)).toBe(
      true,
    );
    expect(covers({ ...exports!, subject: { system: 'aws', environment: 'unknown' } }, s3)).toBe(
      true,
    );
    expect(covers({ ...exports!, subject: { system: 'unknown' } }, s3)).toBe(false);
    expect(covers({ ...exports!, subject: { system: 'ci' } }, find(33))).toBe(false);
    const noResource = { ...s3, target: { system: 'aws' } };
    expect(
      covers({ ...exports!, subject: { system: 'aws', resource: 'exports' } }, noResource),
    ).toBe(false);
    const { target: _t, ...bare } = s3;
    expect(covers({ ...exports!, subject: { system: 'aws' } }, bare)).toBe(false);
  });

  it('keeps an operation-name match strong only on the tool’s own system, and names a targetless change unknown', () => {
    const onSystem = witness({
      n: 40,
      at: ist('14:29:02'),
      target: { system: 'aws', resource: 'exports-prod/other.csv', operation: 'DeleteObject' },
      summary: 'DeleteObject exports-prod/other.csv',
    });
    const withTwin = sideEffects(claims, [...events, onSystem], graph, SIDE_EFFECTS_WINDOW);
    expect(withTwin.effects.find((e) => e.worldEventId === ulid(40))).toMatchObject({
      confidence: 'strong',
      reason: 'operation',
    });
    const { target: _t, ...targetless } = witness({
      n: 41,
      at: ist('14:28:03'),
      target: { system: 'x' },
      attrs: { 'request.id': 'req_bare' },
      summary: 'a change with no target',
    });
    const { target: _u, ...untargetedCall } = toolPair({
      n: 42,
      at: ist('14:28:02'),
      name: 'untargeted',
      system: 'x',
      operation: 'x',
      attrs: { 'request.id': 'req_bare' },
    })[0]!;
    const more = [...events, targetless, untargetedCall];
    const extra = sideEffects(
      claims,
      more,
      buildGraph(more, { runId: SESSION }),
      SIDE_EFFECTS_WINDOW,
    );
    expect(extra.effects.find((e) => e.worldEventId === ulid(41))).toMatchObject({
      system: 'unknown',
      confidence: 'strong',
    });
    const reused = witness({
      n: 43,
      at: ist('14:28:06'),
      actor: { type: 'human', id: 'erin-ops' },
      target: { system: 'neon', resource: 'billing-db/invoices', operation: 'delete' },
      attrs: { 'idempotency.key': 'req_bare' },
      summary: 'erin-ops deleted invoices with a reused key',
    });
    const reusedCall = {
      ...untargetedCall,
      attrs: { ...untargetedCall.attrs, 'idempotency.key': 'req_bare' },
    };
    const withReuse = [...events, reused, reusedCall];
    const blamed = sideEffects(
      claims,
      withReuse,
      buildGraph(withReuse, { runId: SESSION }),
      SIDE_EFFECTS_WINDOW,
    );
    const ids = [...blamed.effects, ...blamed.weak, ...blamed.covered].map((e) => e.worldEventId);
    expect(ids.includes(ulid(43))).toBe(false);
    expect(
      correlateWorld(withReuse, buildGraph(withReuse, { runId: SESSION })).find(
        (link) => link.worldEventId === ulid(43),
      ),
    ).toMatchObject({ confidence: 'strong', reason: 'request' });
    const stillStripe = sideEffects(claims, [...events, targetless], graph, SIDE_EFFECTS_WINDOW);
    expect(stillStripe.effects.some((e) => e.worldEventId === ulid(41))).toBe(false);
    const covering = claimsOf([
      claim({
        n: 50,
        at: ist('14:31:00'),
        text: 'Deleted the endpoint.',
        predicate: 'unchecked',
        subject: { system: 'stripe' },
      }),
    ]);
    const hidden = sideEffects(covering, events, graph, SIDE_EFFECTS_WINDOW);
    expect(hidden.effects.map((e) => e.system)).toEqual(['aws', 'github']);
    expect(hidden.covered.map((e) => [e.system, e.claimId])).toEqual([['stripe', ulid(50)]]);
  });

  it('is the same for any order and duplication of the events', () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray([...events], { minLength: events.length }),
        fc.array(fc.nat(events.length - 1), { maxLength: 8 }),
        (shuffled, extra) => {
          const doubled = [...shuffled, ...extra.map((n) => events[n]!)];
          const rebuilt = buildGraph(doubled, { runId: SESSION });
          expect(sideEffects(claimsOf(doubled), doubled, rebuilt, SIDE_EFFECTS_WINDOW)).toEqual(
            result,
          );
        },
      ),
      { numRuns: 30 },
    );
  });
});
