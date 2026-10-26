import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CANVAS_SESSION } from '../lib/__fixtures__/canvas-claims';
import { type SideEffectView, buildSessionCheck } from '../lib/session-check';
import { sessionCheckInputSchema } from '../lib/session-check-input';
import { SideEffects } from './side-effects';

const CANVAS = buildSessionCheck(sessionCheckInputSchema.parse(CANVAS_SESSION));
const text = (html: string): string => html.replace(/<[^>]+>/g, '');
const effect = (patch: Partial<SideEffectView>): SideEffectView => {
  const [webhook] = CANVAS.sideEffects.counted;
  if (webhook === undefined) throw new Error('the canvas has a side effect');
  return { ...webhook, ...patch };
};
const render = (counted: SideEffectView[], weak: SideEffectView[] = []): string =>
  renderToStaticMarkup(<SideEffects check={{ ...CANVAS, sideEffects: { counted, weak } }} />);

describe('SideEffects', () => {
  it('tells the side effect the agent never mentioned, with the record, the call and the link', () => {
    const html = renderToStaticMarkup(<SideEffects check={CANVAS} />);
    expect(html).toContain(
      '<h2 id="effects-heading" class="sr-only">1 unreported side effect</h2>',
    );
    expect(text(html)).toContain('Seen by Ledgerline · never mentioned by the agent');
    expect(text(html)).toContain(
      'Live webhook endpoint we_0Tq8Vx was deleted. The agent didn’t say a word.',
    );
    expect(text(html)).toContain('● observed · Ledgerline · webhook_endpoint/we_0Tq8Vx · 14:22:07');
    expect(text(html)).toContain('○ reported · tool call webhookEndpoints.del · 14:22:06');
    expect(text(html)).toContain('◇ derived · linked by request id · confidence exact');
    expect(html).toMatch(/<button type="button" disabled="" aria-describedby="check-soon"/);
    expect(html).not.toContain('weak-links');
  });

  it('lists weak links apart, dashed and uncounted, and says so when nothing was left out', () => {
    const html = render([], [effect({ confidence: 'weak', via: undefined })]);
    expect(html).toContain('>0 unreported side effects</h2>');
    expect(html).toContain('data-testid="no-side-effects"');
    expect(html).toContain('border-dashed border-line-strong');
    expect(text(html)).toContain('Weak links · listed apart, never counted');
    expect(text(html)).toContain('◇ derived · linked · confidence weak');
    expect(html).not.toContain('data-testid="side-effect"');
  });

  it('keeps the stop it was given, and falls back to the kind and an unknown system', () => {
    const world = effect({}).world;
    const bare = effect({ world: { ...world, summary: undefined, target: undefined } });
    const loud = effect({ world: { ...world, id: effect({}).toolCall.id, summary: 'Deleted!' } });
    const html = text(render([bare, loud], [{ ...bare, confidence: 'weak' }]));
    expect(html).toContain('>2 unreported side effects'.slice(1));
    expect(html).toContain('world.change. The agent');
    expect(html).toContain('never countedworld.change.');
    expect(html).toContain('Seen by unknown');
    expect(html).toContain('Deleted! The agent');
  });
});
