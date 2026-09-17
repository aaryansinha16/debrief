// @vitest-environment jsdom
import { createReplay, createReplayClock } from '@debrief/ui';
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Subtitles } from './subtitles';

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

describe('Subtitles', () => {
  const events = demoRunFixture().filter((event) => event.runId === DEMO_RUN_ID);
  const replay = createReplay(events);
  const clock = createReplayClock(replay.duration);
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await update(() => {
      root.render(<Subtitles clock={clock} replay={replay} />);
    });
  });

  afterEach(async () => {
    await update(() => {
      root.unmount();
    });
    container.remove();
  });

  it('follows the clock: the current event summary, kind and provenance, before-the-first-event otherwise', async () => {
    const overlay = (): HTMLElement => container.querySelector('[data-testid="subtitle-overlay"]')!;
    await update(() => {
      clock.getState().seek(0);
    });
    expect(container.querySelector('[data-testid="subtitle"]')?.getAttribute('data-seq')).toBe(
      String(replay.events[replay.indexAt(0) - 1]!.event.seq),
    );
    const observed = replay.events.find((entry) => entry.event.kind === 'world.change')!;
    await update(() => {
      clock.getState().seek(observed.t);
    });
    const subtitle = container.querySelector('[data-testid="subtitle"]')!;
    expect(subtitle.getAttribute('data-seq')).toBe(String(observed.event.seq));
    expect(subtitle.textContent).toContain(observed.event.summary!);
    expect(subtitle.textContent).toContain('world.change');
    expect(subtitle.querySelector('.text-ember')?.textContent).toBe('observed');
    const llm = replay.events.find((entry) => entry.event.kind === 'llm.call')!;
    await update(() => {
      clock.getState().seek(llm.t);
    });
    expect(container.querySelector('[data-testid="subtitle"]')?.className).toContain('italic');
    expect(container.querySelector('[data-testid="subtitle"] .text-cyan')?.textContent).toBe(
      'reported',
    );
    expect(overlay().className).toContain('pointer-events-none');
    expect(overlay().className).toContain('bottom-10');
    await update(() => {
      root.render(<Subtitles clock={clock} replay={createReplay([])} />);
    });
    expect(overlay().textContent).toBe('before the first event');
    const silent = createReplay([{ ...events[0]!, summary: undefined }]);
    await update(() => {
      root.render(<Subtitles clock={createReplayClock(0)} replay={silent} />);
    });
    expect(container.querySelector('[data-testid="subtitle"]')?.textContent).toBe(
      `#${String(events[0]!.seq)} ${events[0]!.kind} · reported`,
    );
  });
});
