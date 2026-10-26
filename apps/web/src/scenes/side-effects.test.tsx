import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CANVAS_SESSION } from '../lib/__fixtures__/canvas-claims';
import { type SideEffectView, buildSessionCheck } from '../lib/session-check';
import { sessionCheckInputSchema } from '../lib/session-check-input';
import { SideEffectCard } from './side-effects';

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
    expect(text(html)).toContain('Seen by Ledgerline · never mentioned by the agent');
    expect(text(html)).toContain(
      'Live webhook hk-0Tq8Vx was deleted. The agent didn’t say a word.',
    );
    expect(text(html)).toContain('● observed · Ledgerline · hooks/hk-0Tq8Vx · 14:22:07');
    expect(text(html)).toContain('○ reported · tool call hooks.remove · 14:22:06');
    expect(text(html)).toContain('◇ derived · linked by request id · confidence exact');
    expect(html).toContain('class="side-effect ');
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
