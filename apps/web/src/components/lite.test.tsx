// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Lite } from './lite';
import { PageTransition } from './page-transition';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/navigation', () => ({ usePathname: () => '/runs' }));

const update = async (change: () => void): Promise<void> => {
  await act(async () => {
    change();
    await Promise.resolve();
  });
};

describe('page chrome', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await update(() => {
      root.unmount();
    });
    container.remove();
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
    expect(container.querySelector('canvas')).toBeNull();
    await update(() => {
      root.render(<p>y</p>);
    });
    expect(document.documentElement.dataset.lite).toBeUndefined();
  });
});
