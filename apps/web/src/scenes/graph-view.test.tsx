// @vitest-environment jsdom
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { layout as layoutGraph, reconstructGraph } from '@debrief/reconstruct';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GraphCanvasProps } from './graph-canvas';
import { GraphHoverCard, ProvenanceLegend } from './graph-hover-card';
import { GraphView } from './graph-view';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { loaders } = vi.hoisted(() => ({
  loaders: [] as { loader: () => Promise<unknown>; loading?: () => React.ReactNode }[],
}));

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<unknown>, options?: { loading?: () => React.ReactNode }) => {
    loaders.push({
      loader,
      ...(options?.loading === undefined ? {} : { loading: options.loading }),
    });
    return function CanvasStub({ scene, hovered, onHover }: GraphCanvasProps) {
      return (
        <div data-testid="canvas-stub" data-hovered={hovered ?? ''}>
          <button
            type="button"
            data-testid="hover-first"
            onClick={() => {
              onHover(0);
            }}
          >
            hover
          </button>
          <button
            type="button"
            data-testid="hover-none"
            onClick={() => {
              onHover(undefined);
            }}
          >
            leave
          </button>
          {scene.nodes.length}
        </div>
      );
    };
  },
}));

const update = async (change: () => void): Promise<void> => {
  await act(async () => {
    change();
    await Promise.resolve();
  });
};

describe('GraphView', () => {
  const events = demoRunFixture();
  const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
  const layout = layoutGraph(graph, 'view-test');
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await update(() => {
      root.render(<GraphView graph={graph} layout={layout} events={events} />);
    });
  });

  afterEach(async () => {
    await update(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders the stage, stats and legend, and shows a hover card with a verify link on hover', async () => {
    expect(container.querySelector('[data-testid="graph-stats"]')?.textContent).toBe(
      `${String(graph.nodes.length)} nodes · ${String(graph.edges.length)} edges`,
    );
    expect(container.querySelector('[data-testid="legend"]')?.textContent).toContain('observed');
    expect(container.querySelector('[data-testid="hover-card"]')).toBeNull();
    await update(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="hover-first"]')!.click();
    });
    const card = container.querySelector('[data-testid="hover-card"]')!;
    expect(card.textContent).toContain(graph.nodes[0]!.label);
    expect(card.querySelector('[data-testid="verify"]')?.getAttribute('href')).toBe(
      `/api/proof?event=${graph.nodes[0]!.eventIds[0]!}`,
    );
    expect(
      container.querySelector('[data-testid="canvas-stub"]')?.getAttribute('data-hovered'),
    ).toBe('0');
    await update(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="hover-none"]')!.click();
    });
    expect(container.querySelector('[data-testid="hover-card"]')).toBeNull();
  });
});

describe('dynamic canvas loading', () => {
  it('loads the real canvas module lazily and shows a loading stage meanwhile', async () => {
    const entry = loaders[0]!;
    expect(renderToStaticMarkup(<>{entry.loading?.()}</>)).toContain('loading the stage');
    const module = (await entry.loader()) as
      { GraphCanvas?: unknown } | ((...args: unknown[]) => unknown);
    expect(typeof module === 'function' || typeof module.GraphCanvas === 'function').toBe(true);
  });
});

describe('GraphHoverCard', () => {
  it('shows provenance, summary and the verify affordance only when there is an event', () => {
    const observed = renderToStaticMarkup(
      <GraphHoverCard
        node={{
          id: 'resource:orbital:v',
          index: 0,
          type: 'resource',
          label: 'v',
          position: [0, 0, 0],
          radius: 3,
          color: '#fff',
          provenance: 'observed',
          eventIds: ['e1', 'e2'],
          summary: 'deleted',
        }}
        eventCount={2}
      />,
    );
    expect(observed).toContain('● observed by the world');
    expect(observed).toContain('2 events');
    expect(observed).toContain('deleted');
    expect(observed).toContain('/api/proof?event=e1');
    const bare = renderToStaticMarkup(
      <GraphHoverCard
        node={{
          id: 'agent:a',
          index: 1,
          type: 'agent',
          label: 'a',
          position: [0, 0, 0],
          radius: 3,
          color: '#fff',
          provenance: 'reported',
          eventIds: [],
        }}
        eventCount={0}
      />,
    );
    expect(bare).toContain('○ reported by the agent');
    expect(bare).toContain('0 events');
    const single = renderToStaticMarkup(
      <GraphHoverCard
        node={{
          id: 'llm:x',
          index: 2,
          type: 'llm',
          label: 'atlas',
          position: [0, 0, 0],
          radius: 2,
          color: '#fff',
          provenance: 'reported',
          eventIds: ['e9'],
        }}
        eventCount={1}
      />,
    );
    expect(single.replace(/<!--.*?-->/g, '')).toContain('1 event</p>');
    expect(bare).not.toContain('/api/proof');
    expect(renderToStaticMarkup(<ProvenanceLegend />)).toContain('○ reported');
  });
});
