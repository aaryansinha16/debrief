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
  const playing = useStore(clock, (state) => state.playing);
  const rate = useStore(clock, (state) => state.rate);
  useReplayTicker(clock);
  useReplayKeys(clock, replay, markers);
  const world = replay.stateAt(t);
  const current = replay.events[Math.max(0, replay.indexAt(t) - 1)];
  const touched = Object.values(world.resources);
  const tokens = Object.values(world.tokens);

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
          {formatClock(t)} / {formatClock(replay.duration)}
        </span>
        <span className="text-text-muted" data-testid="applied">
          {world.applied} / {replay.events.length} events
        </span>
        <span className="ml-auto text-xs text-text-muted">space · ← → · [ ]</span>
      </div>
      <Scrubber replay={replay} clock={clock} markers={markers} />
      <p className="min-h-6 text-sm text-text" data-testid="subtitle">
        {world.applied === 0 || current === undefined ? (
          <span className="text-text-muted">before the first event</span>
        ) : (
          <>
            <span className="mr-2 font-mono text-xs text-text-muted">
              #{current.event.seq} {current.event.kind} · {current.event.provenance}
            </span>
            {current.event.summary ?? ''}
          </>
        )}
      </p>
      <div className="grid gap-4 text-sm md:grid-cols-2">
        <div>
          <h2 className="mb-2 text-xs tracking-wider text-text-muted uppercase">World</h2>
          {touched.length === 0 ? (
            <p className="text-text-muted">nothing observed yet</p>
          ) : (
            <ul className="flex flex-col gap-1" data-testid="resources">
              {touched.map((resource) => (
                <li key={`${resource.system}:${resource.resource}`} className="font-mono text-xs">
                  <span className="text-cyan">{resource.resource}</span>{' '}
                  <span className="text-text-muted">{resource.lastOperation ?? ''}</span>{' '}
                  {Object.entries(resource.fields)
                    .map(([field, value]) => `${field}=${String(value)}`)
                    .join(' ')}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2 className="mb-2 text-xs tracking-wider text-text-muted uppercase">Tokens</h2>
          {tokens.length === 0 ? (
            <p className="text-text-muted">no grants yet</p>
          ) : (
            <ul className="flex flex-col gap-1" data-testid="tokens">
              {tokens.map((token) => (
                <li key={token.tokenRef} className="font-mono text-xs">
                  <span className={token.revoked ? 'text-text-muted line-through' : 'text-cyan'}>
                    {token.label ?? token.tokenRef}
                  </span>{' '}
                  <span className="text-text-muted">
                    scope {token.scope.join(',') || '—'} · perms{' '}
                    {token.permissions.join(',') || '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
