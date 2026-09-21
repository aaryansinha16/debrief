import { reconstructGraph } from '@debrief/reconstruct';
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { createReplay } from '@debrief/ui';
import { describe, expect, it } from 'vitest';

import { mapFrame, mapLayout } from './map-layout';
import {
  CAMERA_GLIDE_MS,
  CAMERA_OFFSET,
  CAMERA_PUSH,
  PACKET_MS,
  arc,
  blastFocus,
  cameraPose,
  ease,
  focusPoints,
  packetPhase,
  pointAt,
  stageModel,
  toWorld,
} from './stage-model';

const events = demoRunFixture();
const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
const layout = mapLayout(graph, events);
const model = stageModel(layout);
const order = createReplay(events).events.map((entry) => entry.event.id);

describe('stageModel', () => {
  it('puts every zone, node and edge on the ground plane with the map centred at the origin', () => {
    expect(toWorld(500, 240)).toEqual([0, 0, 0]);
    expect(toWorld(0, 0, 5)[0]).toBeLessThan(0);
    expect(toWorld(0, 0, 5)[2]).toBeLessThan(0);
    expect(model.zones).toHaveLength(layout.zones.length);
    expect(model.nodes).toHaveLength(layout.nodes.length);
    expect(model.edges).toHaveLength(layout.edges.length);
    for (const node of model.nodes) {
      const zone = model.zoneOf(node.id)!;
      expect(zone.id).toBe(node.zone);
      expect(Math.abs(node.position[0] - zone.center[0])).toBeLessThan(zone.size[0] / 2);
      expect(Math.abs(node.position[2] - zone.center[2])).toBeLessThan(zone.size[1] / 2);
      expect(node.position[1]).toBeGreaterThan(0);
      expect(node.labelAt[0]).toBeGreaterThan(node.position[0]);
    }
    expect(model.zoneOf('ghost')).toBeUndefined();
    const dangling = stageModel({
      ...layout,
      edges: [{ id: 'x', from: 'ghost', to: 'agent:coding-agent', type: 'calls', eventIds: [] }],
    });
    expect(dangling.edges).toEqual([]);
  });

  it('arcs edges above the platforms and samples points along them', () => {
    const points = arc([0, 6, 0], [100, 6, 0], 4);
    expect(points).toHaveLength(5);
    expect(points[0]).toEqual([0, 6, 0]);
    expect(points[4]).toEqual([100, 6, 0]);
    expect(points[2]![1]).toBeGreaterThan(6);
    expect(pointAt(points, 0)).toEqual([0, 6, 0]);
    expect(pointAt(points, 1)).toEqual([100, 6, 0]);
    expect(pointAt(points, 0.5)[0]).toBe(50);
    expect(pointAt(points, 2)).toEqual([100, 6, 0]);
    expect(pointAt([], 0.5)).toEqual([0, 0, 0]);
    expect(pointAt([[1, 2, 3]], 0.5)).toEqual([1, 2, 3]);
  });

  it('eases and paces the packet', () => {
    expect(ease(-1)).toBe(0);
    expect(ease(0.5)).toBe(0.5);
    expect(ease(2)).toBe(1);
    expect(packetPhase(1000, undefined)).toBe(1);
    expect(packetPhase(1000, 1000)).toBe(0);
    expect(packetPhase(1000 + PACKET_MS / 2, 1000)).toBe(0.5);
    expect(packetPhase(5000, 1000)).toBe(1);
  });

  it('settles between the offending call and production after the divergence', () => {
    const focus = blastFocus(model, 'tool:deleteVolume')!;
    const production = model.zones.find((zone) => zone.id === 'production')!;
    const node = model.nodes.find((candidate) => candidate.id === 'tool:deleteVolume')!;
    expect(focus[0]).toBeGreaterThan(node.position[0]);
    expect(focus[0]).toBeLessThan(production.center[0]);
    expect(blastFocus(model, 'ghost')).toBeUndefined();
    expect(blastFocus(model, undefined)).toBeUndefined();
    const noProduction = {
      ...model,
      zones: model.zones.filter((zone) => zone.id !== 'production'),
    };
    expect(blastFocus(noProduction, 'tool:deleteVolume')).toEqual(node.position);
  });

  it('glides the camera between the last and current zone as a function of the clock', () => {
    const start = mapFrame(layout, order, 0);
    const deletion = events.filter(
      (event) => event.kind === 'tool.call' && event.target?.operation === 'deleteVolume',
    );
    const at = order.indexOf(deletion.at(-1)!.id) + 1;
    const frame = mapFrame(layout, order, at);
    const previous = mapFrame(layout, order, at - 1);
    const focus = focusPoints(model, frame, previous);
    expect(focus.current).toEqual(model.zoneOf('tool:deleteVolume')!.center);
    expect(focus.previous).toBeDefined();
    expect(focusPoints(model, start, undefined)).toEqual({
      previous: undefined,
      current: undefined,
    });
    const landed = cameraPose(model, { t: 1000, eventT: 1000, ...focus, pushed: false });
    const settled = cameraPose(model, {
      t: 1000 + CAMERA_GLIDE_MS,
      eventT: 1000,
      ...focus,
      pushed: false,
    });
    const midway = cameraPose(model, {
      t: 1000 + CAMERA_GLIDE_MS / 2,
      eventT: 1000,
      ...focus,
      pushed: false,
    });
    expect(midway.target[0]).not.toBe(settled.target[0]);
    expect(cameraPose(model, { t: 9999, eventT: 1000, ...focus, pushed: false })).toEqual(settled);
    expect(landed.position[1] - landed.target[1]).toBe(CAMERA_OFFSET[1]);
    const pushed = cameraPose(model, { t: 5000, eventT: 1000, ...focus, pushed: true });
    expect(pushed.position[1] - pushed.target[1]).toBe(CAMERA_PUSH[1]);
    const home = cameraPose(model, {
      t: 0,
      eventT: undefined,
      previous: undefined,
      current: undefined,
      pushed: false,
    });
    expect(home.target).toEqual(model.center);
  });
});
