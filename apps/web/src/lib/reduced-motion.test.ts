// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { REDUCED_MOTION, prefersReducedMotion, useReducedMotion } from './reduced-motion';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function stubMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const list = {
    matches: initial,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  const queries: string[] = [];
  vi.stubGlobal('matchMedia', (query: string) => {
    queries.push(query);
    return list;
  });
  return {
    queries,
    listeners,
    set: (matches: boolean) => {
      list.matches = matches;
      for (const listener of listeners) listener();
    },
  };
}

function Probe() {
  return createElement('p', null, useReducedMotion() ? 'still' : 'moving');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reduced motion', () => {
  it('reads false where the browser has no matchMedia, and on the server', () => {
    expect(prefersReducedMotion()).toBe(false);
    vi.stubGlobal('window', undefined);
    expect(prefersReducedMotion()).toBe(false);
    vi.unstubAllGlobals();
    stubMedia(true);
    expect(renderToString(createElement(Probe))).toBe('<p>moving</p>');
  });

  it('reads the media query and follows it until unmounted', async () => {
    const media = stubMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(media.queries).toEqual([REDUCED_MOTION]);
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Probe));
      await Promise.resolve();
    });
    expect(container.textContent).toBe('still');
    await act(async () => {
      media.set(false);
      await Promise.resolve();
    });
    expect(container.textContent).toBe('moving');
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    expect(media.listeners.size).toBe(0);
  });

  it('subscribes to nothing without matchMedia', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Probe));
      await Promise.resolve();
    });
    expect(container.textContent).toBe('moving');
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });
});
