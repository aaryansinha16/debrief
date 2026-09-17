import { describe, expect, it } from 'vitest';

import { RATES, createReplayClock } from './replay-clock.js';

describe('replay clock', () => {
  it('seeks within bounds, plays, pauses, toggles and restarts from the end', () => {
    const clock = createReplayClock(1000);
    const state = (): { t: number; playing: boolean; rate: number } => {
      const { t, playing, rate } = clock.getState();
      return { t, playing, rate };
    };
    clock.getState().seek(500);
    expect(state()).toEqual({ t: 500, playing: false, rate: 1 });
    clock.getState().seek(-5);
    expect(state().t).toBe(0);
    clock.getState().seek(5000);
    expect(state().t).toBe(1000);
    clock.getState().play();
    expect(state()).toMatchObject({ t: 0, playing: true });
    clock.getState().toggle();
    expect(state().playing).toBe(false);
    clock.getState().toggle();
    expect(state().playing).toBe(true);
    clock.getState().pause();
    expect(state().playing).toBe(false);
  });

  it('advances by rate on tick and stops at the end', () => {
    const clock = createReplayClock(100);
    clock.getState().tick(50);
    expect(clock.getState().t).toBe(0);
    clock.getState().setRate(2);
    clock.getState().play();
    clock.getState().tick(10);
    expect(clock.getState().t).toBe(20);
    clock.getState().tick(100);
    expect(clock.getState()).toMatchObject({ t: 100, playing: false });
    clock.getState().setRate(3);
    expect(clock.getState().rate).toBe(1);
    for (const rate of RATES) {
      clock.getState().setRate(rate);
      expect(clock.getState().rate).toBe(rate);
    }
  });

  it('freezes exactly at the stop when playback crosses it, and continues past it on play', () => {
    const clock = createReplayClock(1000);
    clock.getState().setStop(400);
    clock.getState().play();
    clock.getState().tick(300);
    expect(clock.getState()).toMatchObject({ t: 300, playing: true });
    expect(clock.getState().frozenAt).toBeUndefined();
    clock.getState().tick(250);
    expect(clock.getState()).toMatchObject({ t: 400, playing: false, frozenAt: 400 });
    clock.getState().tick(100);
    expect(clock.getState().t).toBe(400);
    clock.getState().play();
    expect(clock.getState().frozenAt).toBeUndefined();
    clock.getState().tick(100);
    expect(clock.getState()).toMatchObject({ t: 500, playing: true });
    clock.getState().seek(100);
    clock.getState().play();
    clock.getState().tick(1000);
    expect(clock.getState()).toMatchObject({ t: 400, playing: false, frozenAt: 400 });
    clock.getState().seek(900);
    expect(clock.getState().frozenAt).toBeUndefined();
    clock.getState().play();
    clock.getState().tick(500);
    expect(clock.getState()).toMatchObject({ t: 1000, playing: false });
    clock.getState().setStop(undefined);
    clock.getState().seek(0);
    clock.getState().play();
    clock.getState().tick(600);
    expect(clock.getState()).toMatchObject({ t: 600, playing: true });
  });

  it('clamps the position when the duration changes', () => {
    const clock = createReplayClock();
    expect(clock.getState().duration).toBe(0);
    clock.getState().setDuration(50);
    clock.getState().seek(40);
    clock.getState().setDuration(-1);
    expect(clock.getState()).toMatchObject({ duration: 0, t: 0 });
  });
});
