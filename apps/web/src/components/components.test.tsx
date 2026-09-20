import type { Run } from '@debrief/schema';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { Button, Kbd, Label, PauseIcon, PlayIcon, Segmented } from './controls';
import { Notice } from './notice';
import { RUN_VIEWS, RunHeader } from './run-header';
import { RunList } from './run-list';
import { Shell } from './shell';

const { pathname } = vi.hoisted(() => ({ pathname: { current: '/runs/abc' } }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

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
    expect(html).toMatch(/aria-current="page"[^>]*href="\/runs"/);
    expect(html).not.toMatch(/aria-current="page"[^>]*href="\/live"/);
    expect(html).toContain('tamper-evident');
    expect(html).toContain('<p>body</p>');
    pathname.current = '/live';
    expect(renderToStaticMarkup(<Shell>x</Shell>)).toMatch(/aria-current="page"[^>]*href="\/live"/);
    expect(renderToStaticMarkup(<Notice title="Oops">why</Notice>)).toContain('why');
    expect(renderToStaticMarkup(<Notice title="Oops" />)).not.toContain('mt-2');
  });
});

describe('controls', () => {
  it('renders the three button weights with an optional icon, disabled state and type', () => {
    const primary = renderToStaticMarkup(
      <Button variant="primary" icon={<PlayIcon />}>
        play
      </Button>,
    );
    expect(primary).toContain('text-cyan');
    expect(primary).toContain('<svg');
    expect(primary).toContain('type="button"');
    expect(renderToStaticMarkup(<Button>quiet</Button>)).toContain('border-stage-edge');
    expect(renderToStaticMarkup(<Button variant="ghost" type="submit" disabled />)).toMatch(
      /type="submit"[^>]*disabled=""/,
    );
    expect(renderToStaticMarkup(<PauseIcon />)).toContain('<path');
    expect(renderToStaticMarkup(<Label>zone</Label>)).toContain('uppercase');
    expect(renderToStaticMarkup(<Kbd>space</Kbd>)).toContain('<kbd');
  });

  it('marks the chosen segment and reports a change', () => {
    const chosen: number[] = [];
    const html = renderToStaticMarkup(
      <Segmented
        label="rate"
        options={[
          { value: 1, label: '1×' },
          { value: 2, label: '2×' },
        ]}
        value={2}
        onChange={(value) => {
          chosen.push(value);
        }}
      />,
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/aria-checked="false"[^>]*>1×/);
    expect(html).toMatch(/aria-checked="true"[^>]*>2×/);
  });
});

describe('RunHeader', () => {
  it('shows the run facts once, the views as tabs with the current one lit, and the detail line', () => {
    const html = renderToStaticMarkup(
      <RunHeader run={run()} view="blast" divergences={1} detail={<b>from x</b>} />,
    );
    expect(html).toContain('a1ad49b2…');
    expect(html).toContain('data-testid="run-id"');
    expect(html).toContain('coding-agent');
    expect(html).toContain('human:aaryan');
    expect(html).toContain('6.0 s');
    expect(html).toContain('1 divergence<');
    expect(html).toMatch(/text-ember[^>]*>critical</);
    for (const view of RUN_VIEWS) {
      expect(html).toContain(`href="/runs/a1ad49b23b7fcebdac2bba6d1a244b1a${view.path}"`);
    }
    expect(html).toMatch(/aria-current="page"[^>]*href="[^"]*\/blast"/);
    expect(html).toContain('<b>from x</b>');
    const bare = renderToStaticMarkup(
      <RunHeader run={run({ riskMax: undefined })} view="theatre" divergences={2} />,
    );
    expect(bare).not.toContain('risk');
    expect(bare).toContain('2 divergences');
    expect(bare).not.toContain('data-testid="run-detail"');
    expect(renderToStaticMarkup(<RunHeader run={run()} view="evidence" />)).not.toContain(
      'divergence',
    );
    const clean = renderToStaticMarkup(<RunHeader run={run()} view="theatre" divergences={0} />);
    expect(clean).toMatch(/text-text-muted[^>]*>0 divergences</);
  });
});
