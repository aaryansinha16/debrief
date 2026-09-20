// @vitest-environment jsdom
import { generateKeypair, signBytes } from '@debrief/chain';
import { packBundle } from '@debrief/evidence';
import { demoBundle } from '@debrief/evidence/fixtures';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EvidenceJob } from '../lib/api';
import { RegulationChecklist, SealedFile, verifyBytes } from './sealed-file';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const demo = demoBundle();
const good = packBundle(demo.input, demo.sign);
const other = generateKeypair(new Uint8Array(32).fill(3));
const forged = packBundle(demo.input, (digest) => signBytes(digest, other.secretKey));
const tampered = packBundle(
  {
    ...demo.input,
    events: demo.input.events.map((event, index) =>
      index === 3 ? { ...event, hash: 'f'.repeat(64) } : event,
    ),
  },
  demo.sign,
);
const single = demoBundle('evidence-test', { checkpoints: 'one' });
const oneCheckpoint = packBundle({ ...single.input, regulationMap: { version: '0' } }, single.sign);

const job = (status: EvidenceJob['status'], extra: Partial<EvidenceJob> = {}): EvidenceJob => ({
  id: 'job-1',
  runId: demo.input.runIds[0]!,
  status,
  createdAt: '2026-09-18T09:00:00.000Z',
  ...extra,
});

interface Script {
  queued: EvidenceJob | number;
  polls: (EvidenceJob | number)[];
  bundle?: Uint8Array | 'hang';
}

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status });

const respond = (script: Script): ReturnType<typeof vi.fn<typeof fetch>> => {
  const polls = [...script.polls];
  return vi.fn<typeof fetch>().mockImplementation((input, init) => {
    const url = urlOf(input);
    if (init?.method === 'POST') {
      return Promise.resolve(
        typeof script.queued === 'number'
          ? json({ message: 'nope' }, script.queued)
          : json(script.queued, 202),
      );
    }
    if (url.endsWith('/bundle')) {
      if (script.bundle === 'hang') return new Promise<Response>(() => undefined);
      return Promise.resolve(
        script.bundle === undefined
          ? json({}, 404)
          : new Response(script.bundle.slice().buffer, { status: 200 }),
      );
    }
    const next = polls.length > 1 ? polls.shift()! : polls[0]!;
    return Promise.resolve(
      typeof next === 'number' ? json({ message: 'poll failed' }, next) : json(next, 200),
    );
  });
};

const update = async (change: () => void): Promise<void> => {
  await act(async () => {
    change();
    await Promise.resolve();
  });
};

describe('SealedFile', () => {
  let root: Root;
  let container: HTMLDivElement;
  const phase = (): string | null | undefined =>
    container.querySelector('[data-testid="sealed-file"]')?.getAttribute('data-phase');
  const text = (id: string): string | undefined =>
    container.querySelector(`[data-testid="${id}"]`)?.textContent;
  const untilPhase = async (expected: string, limit = 200): Promise<void> => {
    for (let attempt = 0; attempt < limit && phase() !== expected; attempt += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
    }
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:sealed'),
      revokeObjectURL: vi.fn(),
    });
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
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const render = async (policyIds?: string[]): Promise<void> => {
    await update(() => {
      root.render(
        <SealedFile
          runId={demo.input.runIds[0]!}
          verifyUrl="http://verify.test"
          pollMs={10}
          policyIds={policyIds}
        />,
      );
    });
  };
  const submit = async (): Promise<void> => {
    await update(() => {
      container.querySelector('form')!.requestSubmit();
    });
  };

  it('seals, verifies in the browser and only then offers the download, the stamp and the checklist', async () => {
    const fetchMock = respond({
      queued: job('queued'),
      polls: [
        job('running'),
        job('done', { downloadUrl: 'https://storage.test/x.zip', bytes: good.byteLength }),
      ],
      bundle: good,
    });
    vi.stubGlobal('fetch', fetchMock);
    await render();
    expect(phase()).toBe('idle');
    expect(container.querySelector('[data-testid="download"]')).toBeNull();
    await update(() => {
      container.querySelector<HTMLInputElement>('[data-testid="include-content"]')!.click();
    });
    await submit();
    await untilPhase('sealed');
    expect(text('seal-failure')).toBeUndefined();
    expect(phase()).toBe('sealed');
    const [, postInit] = fetchMock.mock.calls[0]!;
    expect(postInit?.body).toBe(JSON.stringify({ includeContent: true, policyId: 'prod-guard' }));
    expect(
      fetchMock.mock.calls.filter(([url]) => urlOf(url) === '/api/evidence/job-1').length,
    ).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('[data-testid="seal-stamp"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="download"]')?.getAttribute('href')).toBe(
      'blob:sealed',
    );
    expect(container.querySelector('[data-testid="download"]')?.getAttribute('download')).toBe(
      'debrief-evidence-job-1.zip',
    );
    expect(container.querySelector('[data-testid="storage-link"]')?.getAttribute('href')).toBe(
      'https://storage.test/x.zip',
    );
    expect(container.querySelector('[data-testid="verifier-link"]')?.getAttribute('href')).toBe(
      'http://verify.test',
    );
    expect(text('verification')).toContain('✓ event-inclusion');
    expect(container.querySelector('[data-testid="verification-failure"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid="framework"]')).toHaveLength(3);
    expect(
      container.querySelectorAll('[data-testid="element"][data-support="supports"]').length,
    ).toBeGreaterThan(5);
    expect(text('sealed')).toContain('47 events · 2 checkpoints');
  });

  it('reads a single-checkpoint bundle, an api download path and an unreadable map', async () => {
    const fetchMock = respond({
      queued: job('queued'),
      polls: [job('done', { downloadUrl: '/v1/evidence/job-1/bundle.zip' })],
      bundle: oneCheckpoint,
    });
    vi.stubGlobal('fetch', fetchMock);
    await render([]);
    await submit();
    await untilPhase('sealed');
    expect(text('sealed')).toContain('47 events · 1 checkpoint ·');
    expect(container.querySelector('[data-testid="storage-link"]')).toBeNull();
    expect(text('regulation-checklist')).toContain('cannot read');
    expect(fetchMock.mock.calls[0]![1]?.body).toBe(
      JSON.stringify({ includeContent: false, policyId: 'prod-guard' }),
    );
  });

  it('withholds the download when the bundle does not verify or cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      respond({ queued: job('queued'), polls: [job('done')], bundle: forged }),
    );
    await render();
    await submit();
    await untilPhase('rejected');
    expect(phase()).toBe('rejected');
    expect(container.querySelector('[data-testid="download"]')).toBeNull();
    expect(container.querySelector('[data-testid="seal-stamp"]')).toBeNull();
    expect(text('verification-failure')).toContain('manifest-signature');
    expect(text('verification-failure')).toContain('· the detached signature');
    expect(text('seal-rejected')).toContain('withheld');
    vi.stubGlobal(
      'fetch',
      respond({ queued: job('queued'), polls: [job('done')], bundle: tampered }),
    );
    await submit();
    await untilPhase('sealing');
    // While a seal is in flight the policy choice is locked.
    const locked = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-testid="policy"] [role="radio"]'),
    ).find((candidate) => candidate.textContent === 'allow-all')!;
    await update(() => {
      locked.click();
    });
    expect(container.querySelector('[data-testid="policy"]')?.getAttribute('data-value')).toBe(
      'prod-guard',
    );
    await untilPhase('rejected');
    expect(text('verification-failure')).toContain('event-hash');
    expect(text('verification-failure')).toMatch(/· \(seq \d+\) · /);
    vi.stubGlobal(
      'fetch',
      respond({ queued: job('queued'), polls: [job('done')], bundle: new Uint8Array([1, 2, 3]) }),
    );
    await submit();
    await untilPhase('sealing');
    await untilPhase('rejected');
    expect(text('seal-rejected')).toContain('bundle.zip: not a zip');
    expect(container.querySelector('[data-testid="verification"]')).toBeNull();
  });

  it('reports a failed job, a refused request, a failed poll and a missing bundle', async () => {
    vi.stubGlobal(
      'fetch',
      respond({
        queued: job('queued'),
        polls: [job('failed', { error: 'no checkpoint covers seq 48 yet' })],
      }),
    );
    await render();
    await submit();
    await untilPhase('failed');
    expect(text('seal-failure')).toBe('no checkpoint covers seq 48 yet');
    expect(text('sealed-placeholder')).toBe('The file was not sealed.');
    vi.stubGlobal('fetch', respond({ queued: job('queued'), polls: [job('failed')] }));
    await submit();
    await untilPhase('sealing');
    await untilPhase('failed');
    expect(text('seal-failure')).toBe('the evidence job failed');
    vi.stubGlobal('fetch', respond({ queued: 503, polls: [] }));
    await submit();
    await untilPhase('sealing');
    await untilPhase('failed');
    expect(text('seal-failure')).toBe('nope');
    vi.stubGlobal('fetch', respond({ queued: job('queued'), polls: [500] }));
    await submit();
    await untilPhase('sealing');
    await untilPhase('failed');
    expect(text('seal-failure')).toBe('poll failed');
    vi.stubGlobal('fetch', respond({ queued: job('queued'), polls: [job('done')] }));
    await submit();
    await untilPhase('sealing');
    await untilPhase('failed');
    expect(text('seal-failure')).toBe('404 from the api');
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('not json', { status: 500 })),
    );
    await submit();
    await untilPhase('sealing');
    await untilPhase('failed');
    expect(text('seal-failure')).toBe('500 from the api');
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue('odd'));
    await submit();
    await untilPhase('failed');
    expect(text('seal-failure')).toBe('unknown error');
    const policyValue = (): string | null =>
      container.querySelector('[data-testid="policy"]')?.getAttribute('data-value') ?? null;
    const option = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-testid="policy"] [role="radio"]'),
    ).find((candidate) => candidate.textContent === 'allow-all')!;
    await update(() => {
      option.click();
    });
    expect(policyValue()).toBe('allow-all');
  });

  it('shows the running and verifying states and stops polling once unmounted', async () => {
    vi.stubGlobal(
      'fetch',
      respond({ queued: job('queued'), polls: [job('done')], bundle: 'hang' }),
    );
    await render();
    await submit();
    await untilPhase('verifying');
    expect(text('seal')).toBe('verifying in the browser…');
    expect(text('sealed-placeholder')).toContain('Checking every hash');
    await update(() => {
      root.unmount();
    });
    root = createRoot(container);
    const fetchMock = respond({ queued: job('queued'), polls: [job('running')] });
    vi.stubGlobal('fetch', fetchMock);
    await render();
    await submit();
    await untilPhase('sealing');
    expect(text('seal')).toContain('sealing…');
    expect(text('sealed-placeholder')).toContain('job job-1 is');
    expect(
      container.querySelector('[data-testid="include-content"]')?.getAttribute('disabled'),
    ).toBe('');
    await update(() => {
      root.unmount();
    });
    const calls = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(calls + 1);
    root = createRoot(container);
  });
});

describe('verifyBytes and the checklist', () => {
  it('verifies the demo bundle and renders every framework of its map', () => {
    const { bundle, verdict } = verifyBytes(good);
    expect(verdict.ok).toBe(true);
    const html = renderToStaticMarkup(
      <RegulationChecklist
        map={{
          version: '1',
          wording: 'supports',
          disclaimer: 'describes the bundle',
          frameworks: [
            {
              id: 'f',
              title: 'Framework',
              reference: 'ref',
              elements: [
                {
                  id: 'a',
                  requirement: 'A',
                  support: 'supports',
                  sections: ['events.jsonl'],
                  note: '',
                },
                {
                  id: 'b',
                  requirement: 'B',
                  support: 'partially-supports',
                  sections: [],
                  note: '',
                },
                { id: 'c', requirement: 'C', support: 'not-applicable', sections: [], note: '' },
              ],
            },
          ],
        }}
      />,
    );
    expect(html).toContain('describes the bundle');
    expect(html).toContain('supports · events.jsonl');
    expect(html).toContain('data-support="partially-supports"');
    expect(html).toContain('data-support="not-applicable"');
    expect(bundle.manifest.runIds).toEqual(demo.input.runIds);
    expect(renderToStaticMarkup(<RegulationChecklist map={undefined} />)).toContain('cannot read');
  });
});
