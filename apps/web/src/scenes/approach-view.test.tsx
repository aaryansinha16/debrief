// @vitest-environment jsdom
import { demoRunFixture } from '@debrief/reconstruct/fixtures';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { liveEvent, liveRun } from '../lib/__fixtures__/live';
import { createApproachStore } from '../lib/approach';
import type { ApproachCanvasProps } from './approach-canvas';
import { AgentHoverCard, ApproachView, parseLiveEvent } from './approach-view';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { seen, push, loaders } = vi.hoisted(() => ({
  seen: [] as ApproachCanvasProps[],
  push: vi.fn(),
  loaders: [] as { loader: () => Promise<unknown>; loading?: () => React.ReactNode }[],
}));

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<unknown>, options?: { loading?: () => React.ReactNode }) => {
    loaders.push({
      loader,
      ...(options?.loading === undefined ? {} : { loading: options.loading }),
    });
    return function CanvasStub(props: ApproachCanvasProps) {
      seen.push(props);
      return (
        <div data-testid="canvas-stub" data-hovered={props.hovered ?? ''}>
          <button
            type="button"
            data-testid="hover-first"
            onClick={() => {
              props.onHover(0);
            }}
          >
            hover
          </button>
          <button
            type="button"
            data-testid="select-first"
            onClick={() => {
              props.onSelect?.(0);
            }}
          >
            open
          </button>
          <button
            type="button"
            data-testid="select-none"
            onClick={() => {
              props.onSelect?.(99);
            }}
          >
            open nothing
          </button>
          <button
            type="button"
            data-testid="labels"
            onClick={() => {
              props.onLabels?.([
                { name: 'orbital', x: 10, y: 20, events: 3, riskMax: 'critical' },
                { name: 'vault', x: 30, y: 40, events: 1 },
              ]);
            }}
          >
            labels
          </button>
        </div>
      );
    };
  },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, ((message: MessageEvent<string>) => void)[]>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, listener: (message: MessageEvent<string>) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  removeEventListener(name: string, listener: (message: MessageEvent<string>) => void): void {
    this.listeners.set(
      name,
      (this.listeners.get(name) ?? []).filter((each) => each !== listener),
    );
  }
  emit(name: string, data: string): void {
    for (const listener of this.listeners.get(name) ?? []) {
      listener(new MessageEvent<string>(name, { data }));
    }
  }
  close(): void {
    this.closed = true;
  }
}

const update = async (change: () => void): Promise<void> => {
  await act(async () => {
    change();
    await Promise.resolve();
  });
};

describe('ApproachView', () => {
  let root: Root;
  let container: HTMLDivElement;
  const runs = [liveRun('run-seeded', { agentName: 'seeded-agent', riskMax: 'high' })];

  beforeEach(() => {
    seen.length = 0;
    push.mockReset();
    FakeEventSource.instances.length = 0;
    vi.stubGlobal('EventSource', FakeEventSource);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await update(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it('seeds the runs, follows the feed in batches, shows the vital signs and the hovered agent', async () => {
    await update(() => {
      root.render(<ApproachView runs={runs} height={400} />);
    });
    const view = container.querySelector('[data-testid="approach-view"]')!;
    expect(view.getAttribute('data-connection')).toBe('connecting');
    expect(container.querySelector('[data-testid="approach-stats"]')?.textContent).toBe(
      '1 agent · 0 systems · 1 principal · 0 received · 0 critical',
    );
    const [source] = FakeEventSource.instances;
    expect(source?.url).toBe('/api/live');
    await update(() => {
      source!.onopen?.();
    });
    expect(view.getAttribute('data-connection')).toBe('live');
    expect(container.querySelector('[data-testid="connection"]')?.textContent).toBe('● live');
    const store = seen[0]!.store;
    await update(() => {
      for (const event of demoRunFixture()) source!.emit('event', JSON.stringify(event));
      source!.emit('event', 'not json');
      source!.emit('event', JSON.stringify({ nope: true }));
    });
    expect(store.getState().version).toBe(2);
    expect(store.getState().received).toBe(49);
    expect(container.querySelector('[data-testid="approach-stats"]')?.textContent).toBe(
      '3 agents · 3 systems · 1 principal · 49 received · 1 critical',
    );
    expect(container.querySelector('[data-testid="agent-card"]')).toBeNull();
    await update(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="hover-first"]')!.click();
    });
    const card = container.querySelector('[data-testid="agent-card"]')!;
    expect(card.textContent).toContain('seeded-agent');
    expect(card.textContent).toContain('risk high');
    expect(card.textContent).toContain('idle');
    expect(card.querySelector('[data-testid="open-run"]')?.getAttribute('href')).toBe(
      '/runs/run-seeded',
    );
    expect(
      container.querySelector('[data-testid="canvas-stub"]')?.getAttribute('data-hovered'),
    ).toBe('0');
    await update(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="select-first"]')!.click();
    });
    expect(push).toHaveBeenCalledWith('/runs/run-seeded');
    await update(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="select-none"]')!.click();
    });
    expect(push).toHaveBeenCalledTimes(1);
    await update(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="labels"]')!.click();
    });
    const labels = [...container.querySelectorAll('[data-testid="zone-label"]')];
    expect(labels.map((label) => label.textContent)).toEqual([
      'orbital · 3 · critical',
      'vault · 1',
    ]);
    expect((labels[0] as HTMLElement).style.left).toBe('10px');
    await update(() => {
      source!.onerror?.();
    });
    expect(container.querySelector('[data-testid="connection"]')?.textContent).toBe(
      '○ offline · retrying',
    );
    await update(() => {
      root.unmount();
    });
    expect(source?.closed).toBe(true);
  });

  it('runs without a feed on a provided store, navigates through the given function and flags the far LOD', async () => {
    const store = createApproachStore('view');
    const navigate = vi.fn();
    store.getState().setConnection('simulated');
    await update(() => {
      root.render(
        <ApproachView store={store} source="none" navigate={navigate} frameloop="always" />,
      );
    });
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(container.querySelector('[data-testid="connection"]')?.textContent).toBe('◌ simulated');
    expect(container.querySelector('[data-testid="approach-stats"]')?.textContent).toBe(
      '0 agents · 0 systems · 0 principals · 0 received · 0 critical',
    );
    expect(seen[0]?.frameloop).toBe('always');
    const many = Array.from({ length: 1001 }, (_, index) => liveRun(`run-${String(index)}`));
    await update(() => {
      store.getState().seedRuns(many);
    });
    expect(container.querySelector('[data-testid="approach-stats"]')?.textContent).toContain(
      'trails and leashes off beyond 1,000 agents',
    );
    await update(() => {
      store.getState().ingest([liveEvent({ runId: 'run-0', target: { system: 'orbital' } })], 0);
    });
    expect(container.querySelector('[data-testid="approach-stats"]')?.textContent).toContain(
      '1001 agents · 1 system · 1 principal',
    );
    await update(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="select-first"]')!.click();
    });
    expect(navigate).toHaveBeenCalledWith('/runs/run-0');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('dynamic canvas loading', () => {
  it('loads the real canvas module lazily and shows a loading stage meanwhile', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const entry = loaders[0]!;
    expect(renderToStaticMarkup(<>{entry.loading?.()}</>)).toContain('loading the approach');
    const module = (await entry.loader()) as
      { ApproachCanvas?: unknown } | ((...args: unknown[]) => unknown);
    expect(typeof module === 'function' || typeof module.ApproachCanvas === 'function').toBe(true);
  });
});

describe('parseLiveEvent and the hover card', () => {
  it('accepts only well-formed events and renders an agent without a principal or summary', async () => {
    const [first] = demoRunFixture();
    expect(parseLiveEvent(JSON.stringify(first))).toEqual(first);
    expect(parseLiveEvent('{')).toBeUndefined();
    expect(parseLiveEvent('{"kind":"tool.call"}')).toBeUndefined();
    const { renderToStaticMarkup } = await import('react-dom/server');
    const html = renderToStaticMarkup(
      <AgentHoverCard
        agent={{
          runId: 'r',
          agentName: 'solo',
          events: 1,
          status: 'active',
          lastAt: 0,
          risk: 'low',
        }}
        now={0}
      />,
    );
    expect(html).toContain('no principal');
    expect(html).toContain('risk low');
    const unknown = renderToStaticMarkup(
      <AgentHoverCard
        agent={{ runId: 'r', agentName: 'new', events: 0, status: 'active' }}
        now={0}
      />,
    );
    expect(unknown).toContain('risk unknown');
    expect(unknown).toContain('0 events');
    expect(unknown).toContain('idle');
    expect(html).toContain('1 event<');
    expect(html).not.toContain('idle');
    const withSystem = renderToStaticMarkup(
      <AgentHoverCard
        agent={{
          runId: 'r',
          agentName: 'busy',
          events: 2,
          status: 'active',
          lastAt: 0,
          risk: 'critical',
          system: 'vault',
          principalId: 'human:kim',
          summary: 'rotating',
        }}
        now={0}
      />,
    );
    expect(withSystem).toContain('human:kim');
    expect(withSystem).toContain('→ vault');
    expect(withSystem).toContain('text-ember');
    expect(withSystem).toContain('rotating');
  });
});
