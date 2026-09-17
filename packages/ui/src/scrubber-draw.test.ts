import { describe, expect, it } from 'vitest';

import {
  type ScrubberContext,
  drawScrubber,
  markerNear,
  timeForX,
  xForTime,
} from './scrubber-draw.js';
import { COLORS } from './tokens.js';

class FakeContext implements ScrubberContext {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 0;
  readonly calls: (string | number)[][] = [];
  clearRect(...args: number[]): void {
    this.calls.push(['clearRect', ...args]);
  }
  fillRect(...args: number[]): void {
    this.calls.push(['fillRect', this.fillStyle, ...args]);
  }
  beginPath(): void {
    this.calls.push(['beginPath']);
  }
  moveTo(...args: number[]): void {
    this.calls.push(['moveTo', ...args]);
  }
  lineTo(...args: number[]): void {
    this.calls.push(['lineTo', ...args]);
  }
  stroke(): void {
    this.calls.push(['stroke', this.strokeStyle, this.lineWidth]);
  }
  arc(...args: number[]): void {
    this.calls.push(['arc', this.fillStyle, ...args]);
  }
  fill(): void {
    this.calls.push(['fill']);
  }
}

describe('drawScrubber', () => {
  it('draws density bars, ember divergence markers, a ringed freeze frame and the playhead', () => {
    const ctx = new FakeContext();
    drawScrubber(ctx, {
      width: 200,
      height: 40,
      t: 500,
      duration: 1000,
      density: [1, 4, 0, 2],
      markers: [
        { t: 250, label: 'deleteVolume', kind: 'divergence' },
        { t: 750, label: 'freeze', kind: 'freeze' },
      ],
    });
    const rects = ctx.calls.filter((call) => call[0] === 'fillRect');
    expect(rects[0]).toEqual(['fillRect', COLORS.stageRaised, 0, 0, 200, 40]);
    expect(rects.slice(1, 5).map((call) => call.slice(1))).toEqual([
      [COLORS.cyanDim, 0, 32, 49, 8],
      [COLORS.cyanDim, 50, 8, 49, 32],
      [COLORS.cyanDim, 100, 40, 49, 0],
      [COLORS.cyanDim, 150, 24, 49, 16],
    ]);
    const markers = rects.filter((call) => call[1] === COLORS.ember);
    expect(markers).toEqual([
      ['fillRect', COLORS.ember, 49, 0, 2, 40],
      ['fillRect', COLORS.ember, 149, 0, 2, 40],
    ]);
    const arcs = ctx.calls.filter((call) => call[0] === 'arc');
    expect(arcs[0]?.slice(2, 5)).toEqual([150, 6, 4]);
    expect(ctx.calls.filter((call) => call[0] === 'stroke')).toEqual([
      ['stroke', COLORS.ember, 2],
      ['stroke', COLORS.text, 1],
    ]);
    expect(ctx.calls).toContainEqual(['moveTo', 100, 0]);
    expect(ctx.calls).toContainEqual(['lineTo', 100, 40]);
    expect(arcs[1]?.slice(1, 5)).toEqual([COLORS.text, 100, 36, 3]);
  });

  it('copes with empty density and zero duration', () => {
    const ctx = new FakeContext();
    drawScrubber(ctx, { width: 100, height: 20, t: 0, duration: 0, density: [], markers: [] });
    expect(ctx.calls.filter((call) => call[0] === 'fillRect')).toHaveLength(2);
    expect(ctx.calls).toContainEqual(['moveTo', 0, 0]);
  });
});

describe('scrubber geometry', () => {
  it('maps time to x and back with clamping', () => {
    expect(xForTime(500, 1000, 200)).toBe(100);
    expect(xForTime(-1, 1000, 200)).toBe(0);
    expect(xForTime(5000, 1000, 200)).toBe(200);
    expect(xForTime(5, 0, 200)).toBe(0);
    expect(timeForX(100, 1000, 200)).toBe(500);
    expect(timeForX(-9, 1000, 200)).toBe(0);
    expect(timeForX(9, 1000, 0)).toBe(0);
  });

  it('finds the nearest marker within the hit radius', () => {
    const markers = [
      { t: 250, label: 'a', kind: 'divergence' as const },
      { t: 260, label: 'b', kind: 'divergence' as const },
    ];
    expect(markerNear(markers, 52, 1000, 200)?.label).toBe('b');
    expect(markerNear(markers, 49, 1000, 200)?.label).toBe('a');
    expect(markerNear(markers, 70, 1000, 200)).toBeUndefined();
    expect(markerNear([], 50, 1000, 200)).toBeUndefined();
  });
});
