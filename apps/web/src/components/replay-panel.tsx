'use client';

import type { Event } from '@debrief/schema';
import {
  RATES,
  type Replay,
  type ReplayClock,
  Scrubber,
  type ScrubberMarker,
  createReplay,
  createReplayClock,
  useReplayKeys,
  useReplayTicker,
} from '@debrief/ui';
import { useMemo, useState } from 'react';
import { useStore } from 'zustand';

export interface ReplayPanelProps {
  events: readonly Event[];
  markers: readonly ScrubberMarker[];
  clock?: ReplayClock;
  replay?: Replay;
}

export const formatClock = (ms: number): string => `${(ms / 1000).toFixed(2)} s`;

export function ReplayPanel({
  events,
  markers,
  clock: shared,
  replay: prepared,
}: ReplayPanelProps) {
  const replay = useMemo(() => prepared ?? createReplay(events), [prepared, events]);
  const [own] = useState(() => createReplayClock(replay.duration));
  const clock = shared ?? own;
  const t = useStore(clock, (state) => state.t);
  const duration = useStore(clock, (state) => state.duration);
  const playing = useStore(clock, (state) => state.playing);
  const rate = useStore(clock, (state) => state.rate);
  useReplayTicker(clock);
  useReplayKeys(clock, replay, markers);
  const world = replay.stateAt(t);

  return (
    <section className="flex flex-col gap-4" data-testid="replay-panel">
      <div className="flex items-center gap-4 text-sm">
        <button
          type="button"
          className="rounded border border-stage-edge px-3 py-1 font-mono hover:bg-stage-raised"
          onClick={() => {
            clock.getState().toggle();
          }}
          aria-pressed={playing}
        >
          {playing ? 'pause' : 'play'}
        </button>
        <label className="flex items-center gap-2 text-text-muted">
          rate
          <select
            className="rounded border border-stage-edge bg-stage px-2 py-1 font-mono text-text"
            value={rate}
            onChange={(event) => {
              clock.getState().setRate(Number(event.target.value));
            }}
          >
            {RATES.map((option) => (
              <option key={option} value={option}>
                {option}×
              </option>
            ))}
          </select>
        </label>
        <span className="font-mono" data-testid="clock">
          {formatClock(t)} / {formatClock(duration)}
        </span>
        <span className="text-text-muted" data-testid="applied">
          {world.applied} / {replay.events.length} events
        </span>
        <span className="ml-auto text-xs text-text-muted">space · ← → · [ ]</span>
      </div>
      <Scrubber replay={replay} clock={clock} markers={markers} />
    </section>
  );
}
