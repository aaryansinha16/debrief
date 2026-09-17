// @vitest-environment jsdom
import { PROD_GUARD_YAML } from '@debrief/policy';
import { demoRunFixture } from '@debrief/reconstruct/fixtures';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BranchView, postBranch } from './branch-view';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const [first] = demoRunFixture();
const branch = {
  runId: 'r/1',
  halted: false,
  prefix: [first],
  timeline: [{ event: first, status: 'happened' }],
  marked: [],
};

describe('postBranch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the yaml to the proxy and returns the branch, or throws the api message', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(branch), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await postBranch('r/1', 'version: 1')).toEqual(branch);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/counterfactual?run=r%2F1');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ policy: 'version: 1' }));
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ message: 'invalid policy' }), { status: 400 }),
        ),
    );
    await expect(postBranch('r', 'x')).rejects.toThrow('invalid policy');
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('"nope"', { status: 502 })),
    );
    await expect(postBranch('r', 'x')).rejects.toThrow('502 from the api');
  });
});

describe('BranchView', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.append(container);
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 400,
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('asks the proxy for the first branch of the run', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(branch), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => {
      root.render(
        <BranchView runId="r/1" events={[first!]} initialYaml={PROD_GUARD_YAML} debounceMs={10} />,
      );
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/counterfactual?run=r%2F1');
    expect(container.querySelector('[data-testid="branch-scene"]')?.getAttribute('data-run')).toBe(
      'r/1',
    );
    expect(container.querySelector('[data-testid="branch-summary"]')?.textContent).toBe(
      'no halt: the run plays through unchanged',
    );
  });
});
