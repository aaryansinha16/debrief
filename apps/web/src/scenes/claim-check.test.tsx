import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CANVAS_SESSION } from '../lib/__fixtures__/canvas-claims';
import { buildSessionCheck } from '../lib/session-check';
import { sessionCheckInputSchema } from '../lib/session-check-input';
import { CheckHero, ClaimCheck } from './claim-check';

const CANVAS = buildSessionCheck(sessionCheckInputSchema.parse(CANVAS_SESSION));
const text = (html: string): string => html.replace(/<[^>]+>/g, '');

describe('CheckHero', () => {
  const html = renderToStaticMarkup(<CheckHero check={CANVAS} />);

  it('heads the canvas session with its verdict and marks it as a sample', () => {
    expect(html).toMatch(
      /<h1 id="check-headline"[^>]*>Seven claims\.<br\/><span class="italic text-contradicted/,
    );
    expect(text(html)).toContain('Two fall apart.');
    expect(text(html)).toContain(
      'Claude Code · acme/billing-api · 25 Oct 2026 · 14:02–14:31 UTC+05:30',
    );
    expect(html).toContain('data-testid="sample"');
    expect(text(html)).toContain('Sample · fixture data');
    expect(text(html)).toContain(
      'Forge, Tidewater, Skyport, Ledgerline and Local git actually recorded.',
    );
    expect(html).toContain('data-testid="integrity-ring"');
  });

  it('offers the replay and the receipt only as disabled buttons that say why', () => {
    expect(
      html.match(/<button type="button" disabled="" aria-describedby="check-soon"/g),
    ).toHaveLength(2);
    expect(html).not.toContain('<a ');
    expect(html).toContain('id="check-soon"');
  });

  it('drops the sample mark for a real session and keeps a calm tone when nothing holds or breaks', () => {
    const real = { ...CANVAS, session: { ...CANVAS.session, sample: false } };
    expect(renderToStaticMarkup(<CheckHero check={real} />)).not.toContain('data-testid="sample"');
    const quiet = {
      ...CANVAS,
      counts: { ...CANVAS.counts, holds: 0, contradicted: 0, noWitness: 7 },
    };
    expect(renderToStaticMarkup(<CheckHero check={quiet} />)).toContain('italic text-text-muted');
    const held = {
      ...CANVAS,
      counts: { ...CANVAS.counts, holds: 7, contradicted: 0, noWitness: 0 },
    };
    expect(renderToStaticMarkup(<CheckHero check={held} />)).toContain('italic text-holds');
  });
});

describe('ClaimCheck', () => {
  it('composes the page', () => {
    expect(renderToStaticMarkup(<ClaimCheck check={CANVAS} />)).toContain(
      'data-testid="check-hero"',
    );
  });
});
