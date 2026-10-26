import { verdictOutcomeSchema } from '@debrief/schema';
import { COLORS } from '@debrief/ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { VERDICT_LOOK, Verdict } from './verdict';

const text = (html: string): string => html.replace(/<[^>]+>/g, '');

describe('Verdict', () => {
  it('gives every outcome its own icon, word and colour, the word in its colour token', () => {
    expect(Object.keys(VERDICT_LOOK)).toEqual(verdictOutcomeSchema.options);
    const looks = Object.values(VERDICT_LOOK);
    for (const field of ['word', 'text', 'color'] as const) {
      expect(new Set(looks.map((look) => look[field])).size).toBe(looks.length);
    }
    expect(VERDICT_LOOK.holds).toMatchObject({ text: 'text-holds', color: COLORS.holds });
    expect(VERDICT_LOOK.contradicted).toMatchObject({
      text: 'text-contradicted',
      color: COLORS.contradicted,
    });
    expect(VERDICT_LOOK['no-witness']).toMatchObject({
      text: 'text-no-witness',
      color: COLORS.noWitness,
    });
  });

  it('draws a check for holds, a cross for contradicted and a dashed "?" for no witness', () => {
    const holds = renderToStaticMarkup(<Verdict outcome="holds" trust="third-party" />);
    expect(holds).toContain('M5 12.5l4.5 4.5L19 7.5');
    expect(holds).toContain('bg-holds');
    expect(holds).toContain('data-trust="third-party"');
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
    expect(none).toContain('data-trust="none"');
  });

  it('labels a verdict backed only by local evidence, whichever way it went', () => {
    for (const outcome of ['holds', 'contradicted'] as const) {
      const html = renderToStaticMarkup(<Verdict outcome={outcome} trust="local" />);
      expect(html, outcome).toContain('data-testid="verdict-local"');
      expect(html, outcome).toContain('data-trust="local"');
      expect(text(html), outcome).toContain('local: backed only by evidence from this machine');
      expect(html, outcome).toContain('class="sr-only"');
    }
  });

  it('cannot be given a verdict the schema would refuse', () => {
    // @ts-expect-error holds records the trust behind it
    const untrusted = renderToStaticMarkup(<Verdict outcome="holds" />);
    expect(untrusted).toContain('data-trust="none"');
    // @ts-expect-error no witness has no trust
    const stray = renderToStaticMarkup(<Verdict outcome="no-witness" trust="local" />);
    expect(stray).not.toContain('verdict-local');
  });
});
