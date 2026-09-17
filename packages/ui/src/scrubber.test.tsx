// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ev } from './__fixtures__/synthetic-run.js';
import { type Replay, createReplay } from './replay.js';
import { type ReplayClock, createReplayClock } from './replay-clock.js';
import { Scrubber, useReplayKeys, useReplayTicker } from './scrubber.js';
import { COLORS } from './tokens.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const update = async (change: () => void): Promise<void> => {
  await act(async () => {
    change();
    await Promise.resolve();
  });
};

const markers = [
  { t: 250, label: 'deleteVolume', kind: 'divergence' as const },
  { t: 750, label: 'freeze', kind: 'freeze' as const },
];

interface Harness {
  root: Root;
  container: HTMLDivElement;
  canvas: () => HTMLCanvasElement;
  ctx: { fillRect: ReturnType<typeof vi.fn>; scale: ReturnType<typeof vi.fn> };
}

function Player({
  replay,
  clock,
  haltAt,
}: {
  replay: Replay;
  clock: ReplayClock;
  haltAt?: number;
}) {
  useReplayTicker(clock);
  useReplayKeys(clock, replay, markers);
  return <Scrubber replay={replay} clock={clock} markers={markers} haltAt={haltAt} />;
}

describe('Scrubber', () => {
  let harness: Harness;
  let replay: Replay;
  let clock: ReplayClock;

  beforeEach(async () => {
    replay = createReplay([0, 250, 500, 750, 1000].map((ms, n) => ev(n, ms, { kind: 'error' })));
    clock = createReplayClock(replay.duration);
    const container = document.createElement('div');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 200,
    });
    document.body.append(container);
    const ctx = { fillRect: vi.fn(), scale: vi.fn() };
    const context = {
      ...ctx,
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 0,
      width: 200,
      height: 40,
      right: 210,
      bottom: 40,
      x: 10,
      y: 0,
      toJSON: () => ({}),
    });
    const root = createRoot(container);
    await update(() => {
      root.render(<Player replay={replay} clock={clock} />);
    });
    harness = { root, container, ctx, canvas: () => container.querySelector('canvas')! };
  });

  afterEach(async () => {
    await update(() => {
      harness.root.unmount();
    });
    harness.container.remove();
    vi.restoreAllMocks();
  });

  it('draws with markers on mount and redraws when the clock moves', async () => {
    const canvas = harness.canvas();
    expect(canvas.getAttribute('aria-valuemax')).toBe('1000');
    expect(harness.ctx.scale).toHaveBeenCalled();
    const emberRects = (): number =>
      harness.ctx.fillRect.mock.calls.filter((call) => call[0] === undefined).length;
    expect(emberRects()).toBe(0);
    const draws = harness.ctx.fillRect.mock.calls.length;
    expect(draws).toBeGreaterThan(0);
    await update(() => {
      clock.getState().seek(500);
    });
    expect(canvas.getAttribute('aria-valuenow')).toBe('500');
    expect(harness.ctx.fillRect.mock.calls.length).toBeGreaterThan(draws);
    expect(harness.ctx.fillRect.mock.calls.map((call) => call.length)).toContain(4);
  });

  it('greys the bars past a halt', async () => {
    const before = harness.ctx.fillRect.mock.calls.length;
    await update(() => {
      harness.root.render(<Player replay={replay} clock={clock} haltAt={500} />);
    });
    const since = harness.ctx.fillRect.mock.calls.slice(before);
    expect(since.some((call) => call[1] === 0 && call[3] === 2)).toBe(true);
  });

  it('seeks on click, snapping to a nearby marker, and shows marker labels on hover', async () => {
    const canvas = harness.canvas();
    await update(() => {
      canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 110 }));
    });
    expect(clock.getState().t).toBe(500);
    await update(() => {
      canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 62 }));
    });
    expect(clock.getState().t).toBe(250);
    expect(harness.container.querySelector('[data-testid="marker-label"]')).toBeNull();
    await update(() => {
      canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 161 }));
    });
    expect(harness.container.querySelector('[data-testid="marker-label"]')?.textContent).toBe(
      'freeze',
    );
    await update(() => {
      canvas.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null }));
    });
    expect(harness.container.querySelector('[data-testid="marker-label"]')).toBeNull();
  });

  it('answers keyboard shortcuts except while typing', async () => {
    await update(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }));
    });
    expect(clock.getState().t).toBe(250);
    const input = document.createElement('input');
    document.body.append(input);
    await update(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }));
    });
    expect(clock.getState().t).toBe(250);
    input.remove();
    await update(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    expect(clock.getState().t).toBe(0);
    const other = new KeyboardEvent('keydown', { key: 'q', bubbles: true, cancelable: true });
    await update(() => {
      window.dispatchEvent(other);
    });
    expect(other.defaultPrevented).toBe(false);
  });

  it('ticks the clock from animation frames while playing', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    await update(() => {
      clock.getState().play();
    });
    expect(frames).toHaveLength(1);
    await update(() => {
      frames[0]!(1100);
    });
    expect(clock.getState().t).toBe(100);
    expect(frames).toHaveLength(2);
    await update(() => {
      clock.getState().pause();
    });
    expect(cancel).toHaveBeenCalled();
  });

  it('re-measures through a ResizeObserver when one exists', async () => {
    const observers: { callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] =
      [];
    class FakeResizeObserver {
      readonly disconnect = vi.fn();
      constructor(readonly callback: ResizeObserverCallback) {
        observers.push({ callback, disconnect: this.disconnect });
      }
      observe(): void {
        return undefined;
      }
      unobserve(): void {
        return undefined;
      }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    await update(() => {
      harness.root.render(<Player key="observed" replay={replay} clock={clock} />);
    });
    expect(observers.length).toBeGreaterThan(0);
    const draws = harness.ctx.fillRect.mock.calls.length;
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 300,
    });
    await update(() => {
      observers.at(-1)!.callback([], observers.at(-1)! as unknown as ResizeObserver);
    });
    expect(harness.ctx.fillRect.mock.calls.length).toBeGreaterThan(draws);
    expect(harness.ctx.fillRect.mock.calls.slice(draws)[0]).toEqual([0, 0, 300, 40]);
    await update(() => {
      harness.root.render(<p>gone</p>);
    });
    expect(observers.at(-1)!.disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('skips drawing when the canvas has no 2d context', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const calls = harness.ctx.fillRect.mock.calls.length;
    await update(() => {
      clock.getState().seek(750);
    });
    expect(harness.ctx.fillRect.mock.calls.length).toBe(calls);
    expect(COLORS.ember).toBe('#ff7a3d');
  });
});
