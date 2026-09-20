// @vitest-environment jsdom
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { createReplay, createReplayClock } from '@debrief/ui';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventCards, fetchBlob } from './event-cards';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SHA = 'ab'.repeat(32);

const update = async (change: () => void): Promise<void> => {
  await act(async () => {
    change();
    await Promise.resolve();
  });
};

describe('EventCards', () => {
  const events = demoRunFixture()
    .filter((event) => event.runId === DEMO_RUN_ID)
    .map((event) => (event.kind === 'llm.call' ? { ...event, payloadSha256: SHA } : event));
  const replay = createReplay(events);
  const clock = createReplayClock(replay.duration);
  const loadBlob = vi.fn(async (sha256: string) => {
    await Promise.resolve();
    if (sha256 !== SHA) throw new Error('unexpected sha');
    return {
      sourceId: 's',
      content: {
        'gen_ai.input.messages': 'prompt [secret:abcd1234]',
        'gen_ai.output.messages': 'answer',
      },
    };
  });
  let root: Root;
  let container: HTMLDivElement;
  const cards = (): HTMLElement[] =>
    Array.from(container.querySelectorAll('[data-testid="event-card"]'));

  beforeEach(async () => {
    loadBlob.mockClear();
    clock.getState().seek(0);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await update(() => {
      root.render(<EventCards clock={clock} replay={replay} loadBlob={loadBlob} />);
    });
  });

  afterEach(async () => {
    await update(() => {
      root.unmount();
    });
    container.remove();
  });

  it('lists reasoning and tool events up to the clock, newest first, and never fetches during playback', async () => {
    expect(container.textContent).toContain('no reasoning yet');
    await update(() => {
      clock.getState().play();
    });
    for (let step = 0; step < 60; step += 1) {
      await update(() => {
        clock.getState().tick(replay.duration / 50);
      });
    }
    expect(clock.getState().playing).toBe(false);
    const listed = cards();
    const expected = replay.events
      .filter((entry) =>
        ['llm.call', 'tool.call', 'tool.result', 'mcp.request', 'mcp.response'].includes(
          entry.event.kind,
        ),
      )
      .map((entry) => entry.event.seq)
      .reverse()
      .slice(0, 40);
    expect(listed.map((card) => Number(card.getAttribute('data-seq')))).toEqual(expected);
    expect(listed.filter((card) => card.getAttribute('data-current') === 'true')).toHaveLength(1);
    expect(loadBlob).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="card-details"]')).toBeNull();
  });

  it('expands a card to its attributes and fetches captured content only on click', async () => {
    await update(() => {
      clock.getState().seek(replay.duration);
    });
    const llmCard = cards().find((card) => card.textContent.includes('llm.call'))!;
    await update(() => {
      llmCard.querySelector('button')!.click();
    });
    const details = llmCard.querySelector('[data-testid="card-details"]')!;
    expect(details.textContent).toContain('gen_ai.request.model');
    expect(loadBlob).not.toHaveBeenCalled();
    const reveal = llmCard.querySelector<HTMLButtonElement>('[data-testid="reveal-blob"]')!;
    expect(reveal.textContent).toBe('show captured content');
    await update(() => {
      reveal.click();
    });
    await update(() => undefined);
    expect(loadBlob).toHaveBeenCalledTimes(1);
    expect(loadBlob).toHaveBeenCalledWith(SHA);
    const content = llmCard.querySelector('[data-testid="blob-content"]')!;
    expect(content.textContent).toContain('gen_ai.input.messages');
    expect(content.textContent).toContain('[secret:abcd1234]');
    expect(content.textContent).toContain('answer');
    await update(() => {
      llmCard.querySelector('button')!.click();
    });
    expect(llmCard.querySelector('[data-testid="card-details"]')).toBeNull();
    const toolCard = cards().find((card) => card.textContent.includes('tool.call'))!;
    await update(() => {
      toolCard.querySelector('button')!.click();
    });
    expect(toolCard.textContent).toContain('no captured content');
    expect(loadBlob).toHaveBeenCalledTimes(1);
  });

  it('renders cards without summaries or known attributes and reports non-Error failures', async () => {
    const bare = createReplay([
      {
        ...events[0]!,
        id: '01J8ZK5R4M2X6P9Q3V7W1Y5N0A',
        seq: 900,
        kind: 'tool.call',
        attrs: {},
        summary: undefined,
        payloadSha256: SHA,
      },
    ]);
    const bareClock = createReplayClock(bare.duration);
    const rejecting = vi.fn<(sha256: string) => Promise<never>>().mockRejectedValue('gone');
    await update(() => {
      root.render(<EventCards clock={bareClock} replay={bare} loadBlob={rejecting} />);
    });
    const card = cards()[0]!;
    expect(card.textContent).toContain('tool.call');
    await update(() => {
      card.querySelector('button')!.click();
    });
    expect(card.querySelector('dl')).toBeNull();
    await update(() => {
      card.querySelector<HTMLButtonElement>('[data-testid="reveal-blob"]')!.click();
    });
    await update(() => undefined);
    expect(card.querySelector('[data-testid="reveal-blob"]')?.textContent).toBe('retry · gone');
  });

  it('fetches through the blob proxy by default', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sourceId: 's', content: {} }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'unrecoverable' }), { status: 410 }),
      )
      .mockResolvedValueOnce(new Response('not json', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchBlob(SHA)).toEqual({ sourceId: 's', content: {} });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/blob?sha=${SHA}`);
    await expect(fetchBlob(SHA)).rejects.toThrow('unrecoverable');
    await expect(fetchBlob(SHA)).rejects.toThrow('500 from /api/blob');
    vi.unstubAllGlobals();
  });

  it('reports a failed fetch and offers a retry', async () => {
    const failing = vi.fn(async () => {
      await Promise.resolve();
      throw new Error('the tenant data key was destroyed; this payload is unrecoverable');
    });
    await update(() => {
      root.render(<EventCards clock={clock} replay={replay} loadBlob={failing} limit={3} />);
    });
    await update(() => {
      clock.getState().seek(replay.duration);
    });
    expect(cards()).toHaveLength(3);
    const card = cards().find((c) => c.textContent.includes('llm.call'))!;
    await update(() => {
      card.querySelector('button')!.click();
    });
    await update(() => {
      card.querySelector<HTMLButtonElement>('[data-testid="reveal-blob"]')!.click();
    });
    await update(() => undefined);
    expect(card.querySelector('[data-testid="reveal-blob"]')?.textContent).toContain(
      'retry · the tenant data key was destroyed',
    );
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
