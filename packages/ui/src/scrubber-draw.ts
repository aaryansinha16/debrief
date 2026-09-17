import { COLORS } from './tokens.js';

export interface ScrubberMarker {
  t: number;
  label: string;
  kind: 'divergence' | 'freeze';
}

export interface ScrubberFrame {
  width: number;
  height: number;
  t: number;
  duration: number;
  density: readonly number[];
  markers: readonly ScrubberMarker[];
}

// The subset of CanvasRenderingContext2D the scrubber uses, so drawing is testable with a recording fake.
export interface ScrubberContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  fill(): void;
}

export const MARKER_HIT_PX = 6;

export const xForTime = (t: number, duration: number, width: number): number =>
  duration === 0 ? 0 : (Math.min(Math.max(t, 0), duration) / duration) * width;

export const timeForX = (x: number, duration: number, width: number): number =>
  width === 0 ? 0 : (Math.min(Math.max(x, 0), width) / width) * duration;

// Density bars on the stage, the playhead in text, divergence markers in ember, the freeze frame ringed.
export function drawScrubber(ctx: ScrubberContext, frame: ScrubberFrame): void {
  const { width, height, density, markers, duration, t } = frame;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = COLORS.stageRaised;
  ctx.fillRect(0, 0, width, height);
  const peak = Math.max(1, ...density);
  const barWidth = width / Math.max(1, density.length);
  ctx.fillStyle = COLORS.cyanDim;
  density.forEach((count, index) => {
    const barHeight = (count / peak) * (height - 8);
    ctx.fillRect(index * barWidth, height - barHeight, Math.max(1, barWidth - 1), barHeight);
  });
  ctx.fillStyle = COLORS.stageEdge;
  ctx.fillRect(0, height - 1, width, 1);
  for (const marker of markers) {
    const x = xForTime(marker.t, duration, width);
    ctx.fillStyle = COLORS.ember;
    ctx.fillRect(Math.round(x) - 1, 0, 2, height);
    if (marker.kind === 'freeze') {
      ctx.strokeStyle = COLORS.ember;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, 6, 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const playhead = xForTime(t, duration, width);
  ctx.strokeStyle = COLORS.text;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(playhead, 0);
  ctx.lineTo(playhead, height);
  ctx.stroke();
  ctx.fillStyle = COLORS.text;
  ctx.beginPath();
  ctx.arc(playhead, height - 4, 3, 0, Math.PI * 2);
  ctx.fill();
}

export function markerNear(
  markers: readonly ScrubberMarker[],
  x: number,
  duration: number,
  width: number,
): ScrubberMarker | undefined {
  let best: { marker: ScrubberMarker; distance: number } | undefined;
  for (const marker of markers) {
    const distance = Math.abs(xForTime(marker.t, duration, width) - x);
    if (distance <= MARKER_HIT_PX && (best === undefined || distance < best.distance)) {
      best = { marker, distance };
    }
  }
  return best?.marker;
}
