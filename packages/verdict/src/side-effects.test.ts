import { buildGraph } from '@debrief/reconstruct';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import golden from '../__golden__/side-effects.json' with { type: 'json' };
import { claim, ist, ulid, witness } from './__fixtures__/index.js';
import { SESSION, SIDE_EFFECTS_WINDOW, sideEffectsSession } from './__fixtures__/side-effects.js';
import { claimsOf } from './claims.js';
import { covers, sideEffects } from './side-effects.js';

const events = sideEffectsSession;
const graph = buildGraph(events, { runId: SESSION });
const claims = claimsOf(events);
const result = sideEffects(claims, events, graph, SIDE_EFFECTS_WINDOW);

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

  it('lists the weak link apart, blames no human, counts no read, no local git state, nothing covered', () => {
    expect(result.weak.map((w) => [w.worldEventId, w.confidence, w.reason])).toEqual([
      [ulid(34), 'weak', 'system'],
    ]);
    const listed = new Set([...result.effects, ...result.weak].map((e) => e.worldEventId));
    for (const n of [9, 10, 32, 33, 35, 36]) expect(listed.has(ulid(n)), String(n)).toBe(false);
  });

  it('covers a change only with an asserted claim on its system, environment and resource', () => {
    const [pr, hedged, exports] = claims;
    const prEvent = events.find((e) => e.id === ulid(33))!;
    const s3 = events.find((e) => e.id === ulid(31))!;
    expect(covers(pr!, prEvent)).toBe(true);
    expect(
      covers(
        hedged!,
        events.find((e) => e.id === ulid(30))!,
      ),
    ).toBe(false);
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
    const bare = { ...s3, target: undefined };
    expect(covers({ ...exports!, subject: { system: 'aws' } }, bare)).toBe(false);
    expect(covers({ ...exports!, subject: { system: 'aws', resource: 'exports' } }, bare)).toBe(
      false,
    );
  });

  it('takes every event when no window is given, and ignores unknown tool nodes', () => {
    const all = sideEffects(claims, events, graph);
    expect(all.effects.map((e) => e.worldEventId)).toEqual([ulid(30), ulid(31), ulid(36)]);
    const orphan = { ...graph, nodes: graph.nodes.filter((n) => !n.id.startsWith('tool:')) };
    expect(sideEffects(claims, events, orphan, SIDE_EFFECTS_WINDOW).effects).toEqual([]);
    const nameless = witness({
      n: 40,
      at: ist('14:28:03'),
      target: { operation: 'webhook_endpoint.deleted' } as never,
      attrs: { 'request.id': 'req_7f3a9c1e2b' },
      summary: 'x',
    });
    const { summary: _s, ...bareEvent } = nameless;
    const extra = sideEffects(claims, [...events, bareEvent], graph, SIDE_EFFECTS_WINDOW);
    expect(extra.effects.find((e) => e.worldEventId === ulid(40))).toMatchObject({
      system: 'unknown',
      summary: '',
    });
    const covering = claimsOf([
      claim({
        n: 50,
        at: ist('14:31:00'),
        text: 'Deleted the endpoint.',
        predicate: 'unchecked',
        subject: { system: 'stripe' },
      }),
    ]);
    expect(
      sideEffects(covering, events, graph, SIDE_EFFECTS_WINDOW).effects.map((e) => e.system),
    ).toEqual(['aws', 'github']);
  });

  it('is the same for any order and duplication of the events', () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray([...events], { minLength: events.length }),
        fc.array(fc.nat(events.length - 1), { maxLength: 8 }),
        (shuffled, extra) => {
          const doubled = [...shuffled, ...extra.map((n) => events[n]!)];
          expect(
            sideEffects(
              claimsOf(doubled),
              doubled,
              buildGraph(doubled, { runId: SESSION }),
              SIDE_EFFECTS_WINDOW,
            ),
          ).toEqual(result);
        },
      ),
      { numRuns: 30 },
    );
  });
});
