// @vitest-environment jsdom
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventDetails, fetchBlob } from './event-details';

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

describe('EventDetails', () => {
  const events = demoRunFixture().filter((event) => event.runId === DEMO_RUN_ID);
  const llm = { ...events.find((event) => event.kind === 'llm.call')!, payloadSha256: SHA };
  const tool = events.find((event) => event.kind === 'tool.call')!;
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

  beforeEach(() => {
    loadBlob.mockClear();
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

  it('shows the attributes and fetches captured content only on click', async () => {
    await update(() => {
      root.render(<EventDetails event={llm} loadBlob={loadBlob} />);
    });
    expect(container.textContent).toContain('gen_ai.request.model');
    expect(loadBlob).not.toHaveBeenCalled();
    const reveal = container.querySelector<HTMLButtonElement>('[data-testid="reveal-blob"]')!;
    expect(reveal.textContent).toBe('show captured content');
    await update(() => {
      reveal.click();
    });
    await update(() => undefined);
    expect(loadBlob).toHaveBeenCalledTimes(1);
    expect(loadBlob).toHaveBeenCalledWith(SHA);
    const content = container.querySelector('[data-testid="blob-content"]')!;
    expect(content.textContent).toContain('gen_ai.input.messages');
    expect(content.textContent).toContain('[secret:abcd1234]');
    expect(content.textContent).toContain('answer');
  });

  it('says so when nothing was captured', async () => {
    await update(() => {
      root.render(<EventDetails event={tool} loadBlob={loadBlob} />);
    });
    expect(container.textContent).toContain('no captured content');
    expect(loadBlob).not.toHaveBeenCalled();
  });

  it('renders an event without known attributes and reports non-Error failures', async () => {
    const rejecting = vi.fn<(sha256: string) => Promise<never>>().mockRejectedValue('gone');
    await update(() => {
      root.render(
        <EventDetails event={{ ...tool, attrs: {}, payloadSha256: SHA }} loadBlob={rejecting} />,
      );
    });
    expect(container.querySelector('dl')).toBeNull();
    await update(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="reveal-blob"]')!.click();
    });
    await update(() => undefined);
    expect(container.querySelector('[data-testid="reveal-blob"]')?.textContent).toBe(
      'retry · gone',
    );
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
      root.render(<EventDetails event={llm} loadBlob={failing} />);
    });
    await update(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="reveal-blob"]')!.click();
    });
    await update(() => undefined);
    expect(container.querySelector('[data-testid="reveal-blob"]')?.textContent).toContain(
      'retry · the tenant data key was destroyed',
    );
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
