export type CameraEasing = 'linear' | 'ease-in-out' | 'ease-out';

export interface CameraKeyframe {
  t: number;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  easing: CameraEasing;
  label: string;
  nodeId?: string;
}

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  from: number;
  to: number;
  progress: number;
}

export const ease = (easing: CameraEasing, u: number): number => {
  const x = Math.min(Math.max(u, 0), 1);
  switch (easing) {
    case 'linear':
      return x;
    case 'ease-out':
      return 1 - (1 - x) * (1 - x);
    case 'ease-in-out':
      return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
  }
};

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const lerp3 = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  u: number,
): [number, number, number] => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];

// The pose is a pure function of `t` in seconds: between keyframes the next keyframe's easing shapes the move.
export function cameraPoseAt(
  keyframes: readonly CameraKeyframe[],
  t: number,
): CameraPose | undefined {
  const [first] = keyframes;
  if (first === undefined) return undefined;
  if (t <= first.t) {
    return {
      position: first.position,
      target: first.target,
      fov: first.fov,
      from: 0,
      to: 0,
      progress: 1,
    };
  }
  let from = first;
  let index = 0;
  for (;;) {
    const candidate = keyframes[index + 1];
    if (candidate === undefined || candidate.t > t) break;
    from = candidate;
    index += 1;
  }
  const next = keyframes[index + 1];
  if (next === undefined) {
    return {
      position: from.position,
      target: from.target,
      fov: from.fov,
      from: index,
      to: index,
      progress: 1,
    };
  }
  const progress = ease(next.easing, (t - from.t) / (next.t - from.t));
  return {
    position: lerp3(from.position, next.position, progress),
    target: lerp3(from.target, next.target, progress),
    fov: lerp(from.fov, next.fov, progress),
    from: index,
    to: index + 1,
    progress,
  };
}

export const keyframeTimes = (keyframes: readonly CameraKeyframe[]): number[] =>
  keyframes.map((keyframe) => keyframe.t);
