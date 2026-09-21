// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Ambient, wantsAmbient } from './ambient';
import { Lite } from './lite';
import { PageTransition } from './page-transition';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { pathname, loaders } = vi.hoisted(() => ({
  pathname: { current: '/runs' },
  loaders: [] as (() => Promise<unknown>)[],
}));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<unknown>) => {
    loaders.push(loader);
    return function CanvasStub() {
      return <canvas data-testid="ambient-canvas" />;
    };
  },
}));

const update = async (change: () => void): Promise<void> => {
  await act(async () => {
    change();
    await Promise.resolve();
  });
};

describe('ambient motion', () => {
  let root: Root;
  let container: HTMLDivElement;
  const listeners: ((event: { matches: boolean }) => void)[] = [];
  let matches = false;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    listeners.length = 0;
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => {
        listeners.push(listener);
      },
      removeEventListener: () => undefined,
    }));
  });

  afterEach(async () => {
    await update(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    matches = false;
  });

  it('wants the field everywhere but perf pages and reduced motion', () => {
    expect(wantsAmbient('/runs', false)).toBe(true);
    expect(wantsAmbient('/perf/graph', false)).toBe(false);
    expect(wantsAmbient('/', true)).toBe(false);
  });

  it('mounts the field once motion is allowed and drops it when the preference changes', async () => {
    await update(() => {
      root.render(<Ambient />);
    });
    expect(container.querySelector('[data-testid="ambient-canvas"]')).not.toBeNull();
    await update(() => {
      matches = true;
      listeners[0]?.({ matches: true });
    });
    expect(container.querySelector('[data-testid="ambient"]')).toBeNull();
  });

  it('loads the real field lazily', async () => {
    const module = (await loaders[0]!()) as unknown;
    expect(typeof module).toBe('function');
  });

  it('stays out of perf pages', async () => {
    pathname.current = '/perf/theatre';
    await update(() => {
      root.render(<Ambient />);
    });
    expect(container.querySelector('[data-testid="ambient"]')).toBeNull();
    pathname.current = '/runs';
  });

  it('rises each route in and marks perf pages lite', async () => {
    await update(() => {
      root.render(
        <PageTransition>
          <Lite />
          <p>x</p>
        </PageTransition>,
      );
    });
    expect(container.querySelector('[data-testid="page"]')?.className).toContain('animate-rise');
    expect(document.documentElement.dataset.lite).toBe('1');
    await update(() => {
      root.render(<p>y</p>);
    });
    expect(document.documentElement.dataset.lite).toBeUndefined();
  });
});
