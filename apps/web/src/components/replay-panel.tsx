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
import { TYPE } from '@debrief/ui';
import { useMemo, useState } from 'react';
import { useStore } from 'zustand';

import { Button, Kbd, PauseIcon, PlayIcon, Segmented } from './controls';

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
    <section className="flex flex-col gap-3" data-testid="replay-panel">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          icon={playing ? <PauseIcon /> : <PlayIcon />}
          onClick={() => {
            clock.getState().toggle();
          }}
          aria-pressed={playing}
          className="w-24 justify-center"
        >
          {playing ? 'pause' : 'play'}
        </Button>
        <Segmented
          label="playback rate"
          options={RATES.map((option) => ({ value: option, label: `${String(option)}×` }))}
          value={rate}
          onChange={(next) => {
            clock.getState().setRate(next);
          }}
        />
        <span className={TYPE.id} data-testid="clock">
          {formatClock(t)} <span className="text-text-muted">/ {formatClock(duration)}</span>
        </span>
        <span className={TYPE.meta} data-testid="applied">
          {world.applied} / {replay.events.length} events
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-text-muted">
          <Kbd>space</Kbd> play <Kbd>←</Kbd>
          <Kbd>→</Kbd> step <Kbd>[</Kbd>
          <Kbd>]</Kbd> divergence
        </span>
      </div>
      <Scrubber replay={replay} clock={clock} markers={markers} />
    </section>
  );
}
