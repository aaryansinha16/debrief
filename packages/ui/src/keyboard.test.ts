import { describe, expect, it } from 'vitest';

import { ev } from './__fixtures__/synthetic-run.js';
import { handleReplayKey } from './keyboard.js';
import { createReplay } from './replay.js';
import { createReplayClock } from './replay-clock.js';

describe('handleReplayKey', () => {
  const replay = createReplay([100, 200, 300, 400].map((ms, n) => ev(n, ms, { kind: 'error' })));
  const markers = [
    { t: 100, label: 'one', kind: 'divergence' as const },
    { t: 300, label: 'two', kind: 'freeze' as const },
  ];
  const clock = createReplayClock(replay.duration);
  const press = (key: string): boolean => handleReplayKey(key, clock.getState(), replay, markers);

  it('steps events, jumps markers, toggles and ignores other keys', () => {
    expect(press('x')).toBe(false);
    expect(press('ArrowRight')).toBe(true);
    expect(clock.getState().t).toBe(100);
    press('ArrowRight');
    expect(clock.getState().t).toBe(200);
    press('ArrowLeft');
    expect(clock.getState().t).toBe(100);
    press('ArrowLeft');
    press('ArrowLeft');
    expect(clock.getState().t).toBe(0);
    press(']');
    expect(clock.getState().t).toBe(100);
    press(']');
    expect(clock.getState().t).toBe(300);
    press(']');
    expect(clock.getState().t).toBe(300);
    press('[');
    expect(clock.getState().t).toBe(100);
    press('[');
    expect(clock.getState().t).toBe(0);
    press('End');
    expect(clock.getState().t).toBe(300);
    press('ArrowRight');
    expect(clock.getState().t).toBe(300);
    press('Home');
    expect(clock.getState().t).toBe(0);
    press(' ');
    expect(clock.getState().playing).toBe(true);
    press('ArrowRight');
    expect(clock.getState().playing).toBe(false);
  });
});
