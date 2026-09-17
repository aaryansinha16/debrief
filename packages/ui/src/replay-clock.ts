import { createStore } from 'zustand/vanilla';

// ARCHITECTURE §11: `{ t, rate, playing, seek(t), play(), pause() }`; `t` is milliseconds from the run's first event.
export interface ReplayClockState {
  t: number;
  rate: number;
  playing: boolean;
  duration: number;
  seek(t: number): void;
  play(): void;
  pause(): void;
  toggle(): void;
  setRate(rate: number): void;
  setDuration(duration: number): void;
  tick(elapsedMs: number): void;
}

export const RATES = [0.25, 0.5, 1, 2, 4, 8] as const;

const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max);

export function createReplayClock(duration = 0) {
  return createStore<ReplayClockState>((set, get) => ({
    t: 0,
    rate: 1,
    playing: false,
    duration,
    seek: (t) => {
      set({ t: clamp(t, get().duration) });
    },
    play: () => {
      const state = get();
      set({ playing: true, t: state.t >= state.duration ? 0 : state.t });
    },
    pause: () => {
      set({ playing: false });
    },
    toggle: () => {
      const state = get();
      if (state.playing) state.pause();
      else state.play();
    },
    setRate: (rate) => {
      set({ rate: RATES.includes(rate as (typeof RATES)[number]) ? rate : 1 });
    },
    setDuration: (next) => {
      set({ duration: Math.max(0, next), t: clamp(get().t, Math.max(0, next)) });
    },
    tick: (elapsedMs) => {
      const state = get();
      if (!state.playing) return;
      const next = state.t + elapsedMs * state.rate;
      if (next >= state.duration) set({ t: state.duration, playing: false });
      else set({ t: next });
    },
  }));
}

export type ReplayClock = ReturnType<typeof createReplayClock>;
