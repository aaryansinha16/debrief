import { PROD_GUARD_YAML, parsePolicy } from '@debrief/policy';
import { blastRadius, direct, divergence, layout, reconstructGraph } from '@debrief/reconstruct';
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { describe, expect, it } from 'vitest';

import golden from '../__golden__/nine-seconds.camera.json';
import { type CameraKeyframe, cameraPoseAt, ease, keyframeTimes } from './camera-path.js';

const keyframes = (): CameraKeyframe[] => {
  const events = demoRunFixture();
  const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
  const report = divergence(events, parsePolicy(PROD_GUARD_YAML), graph);
  const blast = blastRadius(graph, report.freezeFrame!.nodeId!, events);
  return direct(graph, layout(graph, 'nine-seconds'), report, blast);
};

describe('cameraPoseAt', () => {
  const frames = keyframes();

  it('matches the golden poses at every keyframe and halfway between them', () => {
    const samples = frames.flatMap((frame, index) => {
      const next = frames[index + 1];
      const times = next === undefined ? [frame.t] : [frame.t, (frame.t + next.t) / 2];
      return times.map((t) => ({ t, pose: cameraPoseAt(frames, t) }));
    });
    expect(samples).toEqual(golden);
    expect(samples).toHaveLength(frames.length * 2 - 1);
  });

  it('is exactly the keyframe pose at each keyframe time', () => {
    for (const [index, frame] of frames.entries()) {
      const pose = cameraPoseAt(frames, frame.t)!;
      expect(pose.position).toEqual(frame.position);
      expect(pose.target).toEqual(frame.target);
      expect(pose.fov).toBe(frame.fov);
      expect(pose.from).toBe(index);
    }
    expect(keyframeTimes(frames)).toEqual(frames.map((frame) => frame.t));
  });

  it('clamps before the first and after the last keyframe and handles coincident times', () => {
    expect(cameraPoseAt([], 3)).toBeUndefined();
    const first = frames[0]!;
    const last = frames[frames.length - 1]!;
    expect(cameraPoseAt(frames, -5)).toEqual({
      position: first.position,
      target: first.target,
      fov: first.fov,
      from: 0,
      to: 0,
      progress: 1,
    });
    expect(cameraPoseAt(frames, last.t + 100)).toMatchObject({
      position: last.position,
      target: last.target,
      fov: last.fov,
      from: frames.length - 1,
      to: frames.length - 1,
    });
    const stacked: CameraKeyframe[] = [
      { ...first, t: 0 },
      { ...first, t: 1, easing: 'linear' },
      { ...last, t: 1, easing: 'linear' },
    ];
    expect(cameraPoseAt(stacked, 1)).toMatchObject({ position: last.position, from: 2, to: 2 });
    expect(cameraPoseAt(stacked, 0.5)).toMatchObject({
      position: first.position,
      from: 0,
      to: 1,
      progress: 0.5,
    });
    const zero: CameraKeyframe[] = [
      { ...first, t: 0 },
      { ...last, t: 0, easing: 'linear' },
    ];
    expect(cameraPoseAt(zero, 0)?.from).toBe(0);
    expect(cameraPoseAt(zero, 0.1)?.from).toBe(1);
  });

  it('eases with the documented curves', () => {
    expect(ease('linear', 0.25)).toBe(0.25);
    expect(ease('ease-out', 0.5)).toBe(0.75);
    expect(ease('ease-in-out', 0.25)).toBe(0.125);
    expect(ease('ease-in-out', 0.75)).toBe(0.875);
    expect(ease('linear', -1)).toBe(0);
    expect(ease('linear', 2)).toBe(1);
  });
});
