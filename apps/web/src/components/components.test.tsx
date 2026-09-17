import type { Run } from '@debrief/schema';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Notice } from './notice';
import { RunList } from './run-list';
import { Shell } from './shell';

const run = (patch: Partial<Run> = {}): Run => ({
  id: 'a1ad49b23b7fcebdac2bba6d1a244b1a',
  tenantId: 'tenant-demo',
  principalId: 'human:aaryan',
  agentName: 'coding-agent',
  startedAt: '2026-09-17T10:35:52.000Z',
  endedAt: '2026-09-17T10:35:58.000Z',
  eventCount: 47,
  status: 'ended',
  riskMax: 'critical',
  divergenceCount: 0,
  graphVersion: 1,
  ...patch,
});

describe('RunList', () => {
  it('lists the demo run with a link, risk accent and counts', () => {
    const html = renderToStaticMarkup(<RunList runs={[run()]} />);
    expect(html).toContain('data-run-id="a1ad49b23b7fcebdac2bba6d1a244b1a"');
    expect(html).toContain('href="/runs/a1ad49b23b7fcebdac2bba6d1a244b1a"');
    expect(html).toContain('a1ad49b2…');
    expect(html).toContain('coding-agent');
    expect(html).toContain('human:aaryan');
    expect(html).toContain('2026-09-17 10:35:52Z');
    expect(html).toContain('6.0 s');
    expect(html).toContain('>47<');
    expect(html).toMatch(/text-ember font-semibold[^>]*>critical</);
  });

  it('styles each risk band and shows an empty state', () => {
    const bands = renderToStaticMarkup(
      <RunList
        runs={[
          run({ id: 'r-low', riskMax: 'low' }),
          run({ id: 'r-medium', riskMax: 'medium' }),
          run({ id: 'r-high', riskMax: 'high' }),
          run({ id: 'r-none', riskMax: undefined, endedAt: undefined }),
        ]}
      />,
    );
    expect(bands).toMatch(/text-text-muted[^>]*>low</);
    expect(bands).toMatch(/text-cyan[^>]*>medium</);
    expect(bands).toMatch(/text-ember[^>]*>high</);
    expect(bands).toMatch(/text-text-muted[^>]*>—</);
    expect(bands).toContain('live');
    const empty = renderToStaticMarkup(<RunList runs={[]} />);
    expect(empty).toContain('data-testid="empty"');
    expect(empty).toContain('pnpm demo:nine-seconds');
  });
});

describe('Shell and Notice', () => {
  it('renders navigation, the footer and notices', () => {
    const html = renderToStaticMarkup(
      <Shell>
        <p>body</p>
      </Shell>,
    );
    expect(html).toContain('href="/runs"');
    expect(html).toContain('href="/live"');
    expect(html).toContain('tamper-evident');
    expect(html).toContain('<p>body</p>');
    expect(renderToStaticMarkup(<Notice title="Oops">why</Notice>)).toContain('why');
    expect(renderToStaticMarkup(<Notice title="Oops" />)).not.toContain('mt-2');
  });
});
