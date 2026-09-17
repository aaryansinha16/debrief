// @vitest-environment jsdom
import { PROD_GUARD_YAML, parsePolicy } from '@debrief/policy';
import {
  blastRadius,
  divergence,
  layout as layoutGraph,
  reconstructGraph,
} from '@debrief/reconstruct';
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RIPPLE_WAVE_MS } from '../lib/ripple';
import { BlastView, waveText } from './blast-view';
import type { GraphCanvasProps } from './graph-canvas';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/dynamic', () => ({
  default: () =>
    function CanvasStub(props: GraphCanvasProps) {
      return (
        <div
          data-testid="canvas-stub"
          data-progress={props.progress}
          data-waves={props.ripple?.hops}
          data-metered={props.onRender === undefined ? 'no' : 'yes'}
        />
      );
    },
}));

const update = async (change: () => void): Promise<void> => {
  await act(async () => {
    change();
    await Promise.resolve();
  });
};

describe('BlastView', () => {
  const events = demoRunFixture();
  const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
  const layout = layoutGraph(graph, 'blast-test');
  const origin = divergence(events, parsePolicy(PROD_GUARD_YAML), graph).freezeFrame!.nodeId!;
  const blast = blastRadius(graph, origin, events);
  const hops = blast.waves.length;
  let root: Root;
  let container: HTMLDivElement;
  let now = 1000;
  const frames: FrameRequestCallback[] = [];
  const cancelled: number[] = [];
  const progressLog: number[] = [];
  const flush = async (): Promise<void> => {
    const pending = frames.splice(0);
    await update(() => {
      for (const frame of pending) frame(now);
    });
  };
  const stub = (): Element => container.querySelector('[data-testid="canvas-stub"]')!;
  const lit = (): number => container.querySelectorAll('[data-lit="yes"]').length;

  beforeEach(async () => {
    now = 1000;
    frames.length = 0;
    cancelled.length = 0;
    progressLog.length = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((frame) => {
      frames.push(frame);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) => {
      cancelled.push(handle);
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await update(() => {
      root.render(
        <BlastView
          graph={graph}
          layout={layout}
          events={events}
          blast={blast}
          onRender={() => undefined}
          onProgress={(progress) => {
            progressLog.push(progress);
          }}
        />,
      );
    });
  });

  afterEach(async () => {
    await update(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('ripples one wave per RIPPLE_WAVE_MS, lights the list as the front arrives and settles', async () => {
    expect(hops).toBeGreaterThanOrEqual(2);
    expect(stub().getAttribute('data-progress')).toBe('0');
    expect(stub().getAttribute('data-waves')).toBe(String(hops));
    expect(stub().getAttribute('data-metered')).toBe('yes');
    expect(container.querySelector('[data-testid="ripple-wave"]')?.textContent).toBe(
      waveText(0, hops),
    );
    expect(lit()).toBe(0);
    now += RIPPLE_WAVE_MS;
    await flush();
    expect(stub().getAttribute('data-progress')).toBe('1');
    expect(container.querySelector('[data-testid="ripple-wave"]')?.textContent).toBe(
      `wave 1 of ${String(hops)}`,
    );
    expect(lit()).toBe(blast.waves[0]!.resources.length);
    now += RIPPLE_WAVE_MS * (hops + 1);
    await flush();
    expect(stub().getAttribute('data-progress')).toBe(String(hops + 1));
    expect(container.querySelector('[data-testid="ripple-wave"]')?.textContent).toContain(
      'settled',
    );
    expect(lit()).toBe(container.querySelectorAll('[data-testid="affected-resource"]').length);
    expect(frames).toHaveLength(0);
    expect(progressLog.at(-1)).toBe(hops + 1);
  });

  it('starts over on request and cancels the pending frame on unmount', async () => {
    now += RIPPLE_WAVE_MS * 5;
    await flush();
    expect(stub().getAttribute('data-progress')).toBe(String(hops + 1));
    await update(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="ripple-replay"]')!.click();
    });
    expect(stub().getAttribute('data-progress')).toBe('0');
    expect(frames).toHaveLength(1);
    expect(progressLog.at(-1)).toBe(0);
    await update(() => {
      root.unmount();
    });
    expect(cancelled.length).toBeGreaterThan(0);
  });
});

describe('waveText', () => {
  it('reads as leaving, wave n of m, then settled, in the singular too', () => {
    expect(waveText(0.5, 1)).toBe('leaving the origin · 1 wave ahead');
    expect(waveText(0, 3)).toBe('leaving the origin · 3 waves ahead');
    expect(waveText(2.4, 3)).toBe('wave 2 of 3');
    expect(waveText(3, 3)).toBe('wave 3 of 3');
    expect(waveText(2, 1)).toBe('1 wave · settled');
    expect(waveText(4, 3)).toBe('3 waves · settled');
  });
});
