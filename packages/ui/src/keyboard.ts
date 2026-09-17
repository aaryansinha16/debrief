import type { Replay } from './replay.js';
import type { ReplayClockState } from './replay-clock.js';
import type { ScrubberMarker } from './scrubber-draw.js';

export type ReplayKey = ' ' | 'ArrowLeft' | 'ArrowRight' | '[' | ']' | 'Home' | 'End';

const EPSILON = 0.001;

const previousEventTime = (replay: Replay, t: number): number => {
  const index = replay.indexAt(t - EPSILON) - 1;
  return replay.events[index]?.t ?? 0;
};

const nextEventTime = (replay: Replay, t: number): number => {
  const index = replay.indexAt(t);
  return replay.events[index]?.t ?? replay.duration;
};

// Space toggles, ←/→ step one event, [ ] jump between divergence markers, Home/End to the clock's edges (the film may outlast the events).
export function handleReplayKey(
  key: string,
  clock: Pick<ReplayClockState, 't' | 'duration' | 'seek' | 'toggle' | 'pause'>,
  replay: Replay,
  markers: readonly ScrubberMarker[],
): boolean {
  switch (key) {
    case ' ':
      clock.toggle();
      return true;
    case 'ArrowLeft':
      clock.pause();
      clock.seek(previousEventTime(replay, clock.t));
      return true;
    case 'ArrowRight':
      clock.pause();
      clock.seek(nextEventTime(replay, clock.t));
      return true;
    case '[': {
      const before = markers.filter((marker) => marker.t < clock.t - EPSILON);
      const target = before[before.length - 1];
      clock.pause();
      clock.seek(target?.t ?? 0);
      return true;
    }
    case ']': {
      const target = markers.find((marker) => marker.t > clock.t + EPSILON);
      clock.pause();
      clock.seek(target?.t ?? clock.duration);
      return true;
    }
    case 'Home':
      clock.pause();
      clock.seek(0);
      return true;
    case 'End':
      clock.pause();
      clock.seek(clock.duration);
      return true;
    default:
      return false;
  }
}
