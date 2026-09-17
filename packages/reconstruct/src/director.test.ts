import { ALLOW_ALL, parsePolicy } from '@debrief/policy';
import type { Event } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import keyframesGolden from '../__golden__/nine-seconds.keyframes.json';
import { DEMO_RUN_ID, demoRunFixture } from './__fixtures__/nine-seconds.js';
import { at, ev, ulid } from './__fixtures__/synthetic.js';
import { blastRadius } from './blast.js';
import { MAX_FOLLOW_SHOTS, direct } from './director.js';
import { divergence } from './divergence.js';
import { buildGraph } from './graph.js';
import { layout } from './layout.js';
import { reconstructGraph } from './pipeline.js';

const prodGuard = parsePolicy(`
version: 1
rules:
  - id: prod-destructive-needs-approval
    match: { target.environment: production, target.risk: [high, critical], target.operation: [delete, drop, truncate, transfer] }
    effect: require_approval
`);

describe('direct on the demo run', () => {
  const events = demoRunFixture();
  const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
  const placed = layout(graph, 'nine-seconds');
  const report = divergence(events, prodGuard, graph);
  const blast = blastRadius(graph, report.freezeFrame!.nodeId!, events);

  it('matches the golden and shoots establishing → follow → freeze → ripple → pull-back', () => {
    const frames = direct(graph, placed, report, blast);
    expect(frames).toEqual(keyframesGolden);
    expect(direct(graph, placed, report, blast)).toEqual(frames);
    expect(frames.map((frame) => frame.label)).toEqual([
      'establishing',
      ...Array<string>(7).fill('follow'),
      'freeze',
      'ripple',
      'ripple',
      'pull-back',
    ]);
    for (let index = 1; index < frames.length; index += 1) {
      expect(frames[index]!.t).toBeGreaterThanOrEqual(frames[index - 1]!.t);
    }
    const freeze = frames.find((frame) => frame.label === 'freeze')!;
    expect(freeze).toMatchObject({
      nodeId: report.freezeFrame?.nodeId,
      fov: 35,
      easing: 'ease-out',
    });
    expect(freeze.target).toEqual(Object.values(placed.positions[freeze.nodeId!]!));
    expect(frames[0]).toMatchObject({ t: 0, fov: 50, label: 'establishing' });
    expect(frames.at(-1)).toMatchObject({ fov: 55, label: 'pull-back' });
    for (const frame of frames) {
      for (const value of [...frame.position, ...frame.target, frame.t]) {
        expect(value).toBe(Math.round(value * 100) / 100);
      }
    }
  });

  it('changes with the layout seed and skips freeze and ripple without a divergence', () => {
    const other = direct(graph, layout(graph, 'other-seed'), report, blast);
    expect(other.map((frame) => frame.label)).toEqual(keyframesGolden.map((frame) => frame.label));
    expect(other).not.toEqual(keyframesGolden);
    const calm = direct(graph, placed, divergence(events, ALLOW_ALL, graph));
    expect(calm.map((frame) => frame.label)).toEqual([
      'establishing',
      ...Array<string>(8).fill('follow'),
      'pull-back',
    ]);
    expect(direct(graph, placed).map((frame) => frame.label)).toEqual(
      calm.map((frame) => frame.label),
    );
    const noBlast = direct(graph, placed, report);
    expect(noBlast.map((frame) => frame.label)).toEqual([
      'establishing',
      ...Array<string>(7).fill('follow'),
      'freeze',
      'pull-back',
    ]);
  });
});

describe('direct on synthetic graphs', () => {
  const call = (seq: number, name: string): Event[] => [
    ev(seq, { kind: 'tool.call', spanId: `s${String(seq)}`, attrs: { 'gen_ai.tool.name': name } }),
    ev(seq + 1, { kind: 'tool.result', spanId: `s${String(seq)}` }),
  ];

  it('returns nothing for an empty graph and copes with nodes missing from the layout', () => {
    const empty = buildGraph([]);
    expect(direct(empty, layout(empty, 'x'))).toEqual([]);
    const graph = buildGraph([
      ev(0, { kind: 'principal.session', actor: { type: 'human', id: 'human:pat' } }),
    ]);
    const frames = direct(graph, { ...layout(graph, 'x'), positions: {} });
    expect(frames.map((frame) => frame.label)).toEqual(['establishing', 'pull-back']);
    expect(frames[1]?.target).toEqual([0, 0, 0]);
    const lonely = buildGraph([
      ev(0, {
        kind: 'world.change',
        provenance: 'observed',
        source: 'world-hook',
        actor: { type: 'system', id: 'orbital-infra' },
      }),
    ]);
    const shots = direct(lonely, layout(lonely, 'x'));
    expect(shots.map((frame) => [frame.label, frame.target])).toEqual([
      ['establishing', [0, 0, -2]],
      ['pull-back', [0, 0, 0]],
    ]);
  });

  it('samples long runs down to the follow budget and ignores unknown freeze or blast nodes', () => {
    const events = Array.from({ length: 60 }, (_, index) =>
      call(index * 2, `tool${String(index)}`),
    ).flat();
    const graph = buildGraph(events);
    const placed = layout(graph, 'x');
    const frames = direct(graph, placed);
    expect(frames.filter((frame) => frame.label === 'follow')).toHaveLength(MAX_FOLLOW_SHOTS);
    const unknownFreeze = direct(graph, placed, {
      runId: 'run-x',
      evaluated: 1,
      points: [],
      freezeFrame: {
        eventId: ulid(0),
        seq: 0,
        kind: 'world.change',
        effect: 'deny',
        explanation: 'x',
      },
    });
    expect(unknownFreeze.map((frame) => frame.label)).not.toContain('freeze');
    const ghostBlast = direct(
      graph,
      placed,
      {
        runId: 'run-x',
        evaluated: 1,
        points: [],
        freezeFrame: {
          eventId: ulid(0),
          seq: 0,
          kind: 'tool.call',
          nodeId: `tool:${ulid(0)}`,
          effect: 'deny',
          explanation: 'x',
        },
      },
      {
        origin: `tool:${ulid(0)}`,
        minConfidence: 'strong',
        recoverable: true,
        groups: {},
        waves: [
          {
            hop: 1,
            resources: [
              {
                nodeId: 'resource:nowhere:x',
                system: 'nowhere',
                resource: 'x',
                recoverable: true,
                reasons: ['read-only'],
                via: {
                  from: `tool:${ulid(0)}`,
                  to: 'resource:nowhere:x',
                  type: 'observes',
                  confidence: 'exact',
                  eventIds: [],
                },
              },
            ],
          },
        ],
      },
    );
    expect(ghostBlast.map((frame) => frame.label)).toEqual([
      'establishing',
      'freeze',
      'ripple',
      'pull-back',
    ]);
    expect(ghostBlast[1]?.t).toBe(0);
    expect(at(0)).toBe('2026-09-17T00:00:00.000Z');
  });
});
