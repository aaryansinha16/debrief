// @vitest-environment jsdom
import { PROD_GUARD_YAML, parsePolicy } from '@debrief/policy';
import { direct, divergence, layout as layoutGraph, reconstructGraph } from '@debrief/reconstruct';
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from 'zustand';

import type { GraphCanvasProps } from './graph-canvas';
import { RunTheatre, theatreDuration } from './run-theatre';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { seen } = vi.hoisted(() => ({ seen: [] as GraphCanvasProps[] }));

vi.mock('next/dynamic', () => ({
  default: () =>
    function CanvasStub(props: GraphCanvasProps) {
      seen.push(props);
      const playing = useStore(props.clock!, (state) => state.playing);
      return (
        <div
          data-testid="canvas-stub"
          data-keyframes={props.keyframes?.length ?? 0}
          data-playing={playing ? 'yes' : 'no'}
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

describe('RunTheatre', () => {
  const events = demoRunFixture();
  const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
  const layout = layoutGraph(graph, 'theatre-test');
  const keyframes = direct(graph, layout, divergence(events, parsePolicy(PROD_GUARD_YAML), graph));
  let root: Root;
  let container: HTMLDivElement;
  const clocks: unknown[] = [];
  const onClock = (clock: unknown): void => {
    clocks.push(clock);
  };

  beforeEach(async () => {
    seen.length = 0;
    clocks.length = 0;
    container = document.createElement('div');
    document.body.append(container);
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 400,
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    root = createRoot(container);
    await update(() => {
      root.render(
        <RunTheatre
          graph={graph}
          layout={layout}
          keyframes={keyframes}
          events={events}
          markers={[]}
          onPose={() => undefined}
          onClock={onClock}
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

  it('spans the film, not just the events', () => {
    expect(theatreDuration(1000, keyframes)).toBe(
      Math.max(1000, ...keyframes.map((f) => f.t * 1000)),
    );
    expect(theatreDuration(9999, [])).toBe(9999);
  });

  it('shares one clock between the stage and the scrubber and hands the keyframes to the canvas', async () => {
    const stub = container.querySelector('[data-testid="canvas-stub"]')!;
    expect(stub.getAttribute('data-keyframes')).toBe(String(keyframes.length));
    expect(stub.getAttribute('data-playing')).toBe('no');
    const clock = seen[0]!.clock!;
    expect(seen[0]?.onPose).toBeDefined();
    await update(() => {
      container.querySelector('button')!.click();
    });
    expect(clock.getState().playing).toBe(true);
    expect(
      container.querySelector('[data-testid="canvas-stub"]')?.getAttribute('data-playing'),
    ).toBe('yes');
    expect(container.querySelector('button')?.textContent).toBe('pause');
    expect(seen.every((props) => props.clock === clock)).toBe(true);
    await update(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(clock.getState().t).toBe(clock.getState().duration);
    expect(clock.getState().duration).toBe(theatreDuration(0, keyframes));
    expect(clocks).toEqual([clock]);
    expect(container.querySelector('[data-testid="applied"]')?.textContent).toBe(
      `${String(events.length)} / ${String(events.length)} events`,
    );
  });
});
