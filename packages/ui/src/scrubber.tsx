'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { handleReplayKey } from './keyboard.js';
import type { Replay } from './replay.js';
import type { ReplayClock } from './replay-clock.js';
import {
  type ScrubberContext,
  type ScrubberFrame,
  type ScrubberMarker,
  drawScrubber,
  markerNear,
  timeForX,
} from './scrubber-draw.js';

export interface ScrubberProps {
  replay: Replay;
  clock: ReplayClock;
  markers?: readonly ScrubberMarker[];
  height?: number;
  buckets?: number;
  haltAt?: number;
}

const EDITABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

// Drives the clock from requestAnimationFrame while playing; one loop per mounted scrubber.
export function useReplayTicker(clock: ReplayClock): void {
  const playing = useStore(clock, (state) => state.playing);
  useEffect(() => {
    if (!playing) return;
    let handle = 0;
    let last = performance.now();
    const frame = (now: number): void => {
      clock.getState().tick(now - last);
      last = now;
      handle = requestAnimationFrame(frame);
    };
    handle = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(handle);
    };
  }, [clock, playing]);
}

export function useReplayKeys(
  clock: ReplayClock,
  replay: Replay,
  markers: readonly ScrubberMarker[],
): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLElement && EDITABLE.has(event.target.tagName)) return;
      if (handleReplayKey(event.key, clock.getState(), replay, markers)) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [clock, replay, markers]);
}

export function Scrubber({
  replay,
  clock,
  markers = [],
  height = 40,
  buckets = 120,
  haltAt,
}: ScrubberProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<ScrubberMarker | undefined>(undefined);
  const t = useStore(clock, (state) => state.t);
  const density = useRef<number[]>([]);
  if (density.current.length !== buckets) density.current = replay.density(buckets);

  useLayoutEffect(() => {
    if (wrapper === null) return;
    const measure = (): void => {
      setWidth(wrapper.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(wrapper);
    return () => {
      observer.disconnect();
    };
  }, [wrapper]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || width === 0) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const raw = canvas.getContext('2d') as
      (ScrubberContext & { scale(x: number, y: number): void }) | null;
    if (raw === null) return;
    raw.scale(dpr, dpr);
    const frame: ScrubberFrame = {
      width,
      height,
      t,
      duration: replay.duration,
      density: density.current,
      markers,
    };
    if (haltAt !== undefined) frame.haltAt = haltAt;
    drawScrubber(raw, frame);
  }, [width, height, t, replay, markers, haltAt]);

  const localX = (event: React.MouseEvent<HTMLCanvasElement>): number =>
    event.clientX - event.currentTarget.getBoundingClientRect().left;

  const onClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const x = localX(event);
      const marker = markerNear(markers, x, replay.duration, width);
      clock.getState().pause();
      clock.getState().seek(marker?.t ?? timeForX(x, replay.duration, width));
    },
    [clock, markers, replay, width],
  );

  const onMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      setHover(markerNear(markers, localX(event), replay.duration, width));
    },
    [markers, replay, width],
  );

  return (
    <div className="relative w-full" data-testid="scrubber" ref={setWrapper}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: `${String(height)}px`,
          display: 'block',
          cursor: 'pointer',
        }}
        role="slider"
        aria-label="replay position"
        aria-valuemin={0}
        aria-valuemax={Math.round(replay.duration)}
        aria-valuenow={Math.round(t)}
        tabIndex={0}
        onClick={onClick}
        onMouseMove={onMove}
        onMouseLeave={() => {
          setHover(undefined);
        }}
      />
      {hover === undefined ? null : (
        <div
          className="pointer-events-none absolute -top-6 rounded bg-stage-raised px-2 py-0.5 font-mono text-xs text-ember"
          style={{ left: `${String((hover.t / Math.max(1, replay.duration)) * width)}px` }}
          data-testid="marker-label"
        >
          {hover.label}
        </div>
      )}
    </div>
  );
}
