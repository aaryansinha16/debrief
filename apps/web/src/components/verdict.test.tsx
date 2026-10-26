import { verdictOutcomeSchema } from '@debrief/schema';
import { COLORS } from '@debrief/ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CANVAS_CLAIMS } from '../lib/__fixtures__/canvas-claims';
import { VERDICT_LOOK, Verdict } from './verdict';

const render = (claim: (typeof CANVAS_CLAIMS)[number]): string =>
  renderToStaticMarkup(
    <Verdict
      outcome={claim.outcome}
      {...(claim.trust === undefined ? {} : { trust: claim.trust })}
    />,
  );

const text = (html: string): string => html.replace(/<[^>]+>/g, '');

describe('Verdict', () => {
  it('gives every outcome its own icon, word and colour', () => {
    expect(Object.keys(VERDICT_LOOK)).toEqual(verdictOutcomeSchema.options);
    const looks = Object.values(VERDICT_LOOK);
    for (const field of ['word', 'text', 'color'] as const) {
      expect(new Set(looks.map((look) => look[field])).size).toBe(looks.length);
    }
    expect(VERDICT_LOOK.holds.color).toBe(COLORS.holds);
    expect(VERDICT_LOOK.contradicted.color).toBe(COLORS.contradicted);
    expect(VERDICT_LOOK['no-witness'].color).toBe(COLORS.noWitness);
  });

  it('splits the canvas session four holds, two contradicted, one without a witness, each with a word', () => {
    const rendered = CANVAS_CLAIMS.map((claim) => ({ claim, html: render(claim) }));
    const count = (outcome: string): number =>
      rendered.filter(({ html }) => html.includes(`data-outcome="${outcome}"`)).length;
    expect([count('holds'), count('contradicted'), count('no-witness')]).toEqual([4, 2, 1]);
    for (const { claim, html } of rendered) {
      const look = VERDICT_LOOK[claim.outcome];
      expect(text(html), claim.said).toContain(look.word);
      expect(html, claim.said).toContain(`class="${look.text}"`);
      expect(html, claim.said).toContain('aria-hidden="true"');
    }
  });

  it('draws a check for holds, a cross for contradicted and a dashed "?" for no witness', () => {
    const holds = renderToStaticMarkup(<Verdict outcome="holds" trust="third-party" />);
    expect(holds).toContain('M5 12.5l4.5 4.5L19 7.5');
    expect(holds).toContain('bg-holds');
    const contradicted = renderToStaticMarkup(
      <Verdict outcome="contradicted" trust="third-party" className="ml-2" />,
    );
    expect(contradicted).toContain('M6 6l12 12M18 6L6 18');
    expect(contradicted).toContain('bg-contradicted');
    expect(contradicted).toContain('ml-2');
    const none = renderToStaticMarkup(<Verdict outcome="no-witness" />);
    expect(none).toContain('border-dashed');
    expect(none).toContain('>?</span>');
    expect(none).not.toContain('<svg');
  });

  it('labels a verdict backed only by local evidence, and only that one', () => {
    const local = CANVAS_CLAIMS.filter((claim) =>
      render(claim).includes('data-testid="verdict-local"'),
    );
    expect(local.map((claim) => claim.said)).toEqual(['Removed the unused feature flag.']);
    const html = render(local[0]!);
    expect(html).toContain('data-trust="local"');
    expect(text(html)).toContain('local: backed only by evidence from this machine');
    expect(html).toContain('class="sr-only"');
    const stray = renderToStaticMarkup(<Verdict outcome="no-witness" trust="local" />);
    expect(stray).not.toContain('verdict-local');
    expect(stray).toContain('data-trust="none"');
    expect(renderToStaticMarkup(<Verdict outcome="holds" />)).toContain('data-trust="none"');
  });
});
