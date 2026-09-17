'use client';

import type { Replay, ReplayClock } from '@debrief/ui';
import { useStore } from 'zustand';

export interface SubtitlesProps {
  clock: ReplayClock;
  replay: Replay;
}

// The reasoning track: the current event's `summary`, on the stage, above the stats and legend, never over the scrubber.
export function Subtitles({ clock, replay }: SubtitlesProps) {
  const t = useStore(clock, (state) => state.t);
  const index = replay.indexAt(t) - 1;
  const current = index < 0 ? undefined : replay.events[index];
  return (
    <div
      className="pointer-events-none absolute right-4 bottom-10 left-4 max-h-14 overflow-hidden text-center"
      data-testid="subtitle-overlay"
      aria-live="polite"
    >
      {current === undefined ? (
        <span className="rounded bg-stage/80 px-2 py-1 text-sm text-text-muted">
          before the first event
        </span>
      ) : (
        <span
          className={`inline-block max-w-3xl rounded bg-stage/80 px-3 py-1 text-sm ${current.event.kind === 'llm.call' ? 'text-text italic' : 'text-text'}`}
          data-testid="subtitle"
          data-seq={current.event.seq}
        >
          <span className="mr-2 font-mono text-xs text-text-muted not-italic">
            #{current.event.seq} {current.event.kind} ·{' '}
            <span className={current.event.provenance === 'observed' ? 'text-ember' : 'text-cyan'}>
              {current.event.provenance}
            </span>
          </span>
          {current.event.summary ?? ''}
        </span>
      )}
    </div>
  );
}
