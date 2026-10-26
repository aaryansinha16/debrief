import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CANVAS_SESSION } from '../lib/__fixtures__/canvas-claims';
import { type SideEffectView, buildSessionCheck } from '../lib/session-check';
import { sessionCheckInputSchema } from '../lib/session-check-input';
import { LINKED_BY, SideEffectCard, SideEffects } from './side-effects';

const CANVAS = buildSessionCheck(sessionCheckInputSchema.parse(CANVAS_SESSION));
const text = (html: string): string => html.replace(/<[^>]+>/g, '');
const effect = (patch: Partial<SideEffectView>): SideEffectView => {
  const [webhook] = CANVAS.sideEffects.counted;
  if (webhook === undefined) throw new Error('the canvas has a side effect');
  return { ...webhook, ...patch };
};
const card = (shown: SideEffectView): string =>
  renderToStaticMarkup(<SideEffectCard effect={shown} offset={330} />);

describe('SideEffectCard', () => {
  it('tells the side effect the agent never mentioned, with the record, the call and the link', () => {
    const html = card(effect({}));
    expect(text(html)).toContain('Seen by Stripe · never mentioned by the agent');
    expect(text(html)).toContain(
      'Live webhook hk-0Tq8Vx was deleted. The agent didn’t say a word.',
    );
    expect(text(html)).toContain('● observed · Stripe · hooks/hk-0Tq8Vx · 14:22:07');
    expect(text(html)).toContain('○ reported · tool call hooks.remove · 14:22:06');
    expect(text(html)).toContain('◇ derived · linked by request id · confidence exact');
    expect(html).toContain('class="side-effect ');
  });

  it('words every reason a link can have', () => {
    expect(Object.values(LINKED_BY)).toEqual([
      'trace id',
      'request id',
      'token',
      'access key id',
      'operation name',
      'system only',
    ]);
    expect(text(card(effect({ via: 'access-key', confidence: 'strong' })))).toContain(
      '◇ derived · linked by access key id · confidence strong',
    );
  });

  it('offers the replay only as a disabled button that says why, beside it', () => {
    const html = card(effect({}));
    const reason = `moment-soon-${effect({}).world.id}`;
    expect(html).toContain(`<button type="button" disabled="" aria-describedby="${reason}"`);
    expect(html).toContain(
      `<p id="${reason}" class="text-[13px] text-text-subtle">The replay is not built yet.</p>`,
    );
    expect(html).not.toContain('bg-contradicted');
  });

  it('keeps the stop it was given, and falls back to the kind and an unknown system', () => {
    const world = effect({}).world;
    const bare = text(
      card(effect({ via: undefined, world: { ...world, summary: undefined, target: undefined } })),
    );
    expect(bare).toContain('world.change. The agent');
    expect(bare).toContain('Seen by unknown');
    expect(bare).toContain('◇ derived · linked · confidence exact');
    expect(text(card(effect({ world: { ...world, summary: 'Deleted!' } })))).toContain(
      'Deleted! The agent',
    );
  });
});

describe('SideEffects', () => {
  const render = (counted: SideEffectView[], weak: SideEffectView[] = []): string =>
    renderToStaticMarkup(<SideEffects check={{ ...CANVAS, sideEffects: { counted, weak } }} />);

  it('counts the canvas side effect under its own heading, with no weak links', () => {
    const html = renderToStaticMarkup(<SideEffects check={CANVAS} />);
    expect(html).toContain(
      '<h2 id="effects-heading" class="sr-only">1 unreported side effect</h2>',
    );
    expect(html.match(/data-testid="side-effect"/g)).toHaveLength(1);
    expect(html).not.toContain('weak-links');
  });

  it('lists weak links apart, dashed and uncounted, and says so when nothing was left out', () => {
    const world = effect({}).world;
    const weak = effect({
      confidence: 'weak',
      via: undefined,
      world: { ...world, summary: undefined },
    });
    const html = render([], [weak]);
    expect(html).toContain('>0 unreported side effects</h2>');
    expect(html).toContain('data-testid="no-side-effects"');
    expect(html).toContain('border-dashed border-line-strong');
    expect(text(html)).toContain('Weak links · listed apart, never countedworld.change.');
    expect(text(html)).toContain('◇ derived · linked · confidence weak');
    expect(html).not.toContain('data-testid="side-effect"');
    const two = effect({ world: { ...world, id: effect({}).toolCall.id } });
    expect(render([effect({}), two])).toContain('>2 unreported side effects</h2>');
  });
});
