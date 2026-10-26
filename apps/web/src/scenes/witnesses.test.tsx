import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CANVAS_SESSION } from '../lib/__fixtures__/canvas-claims';
import { buildSessionCheck } from '../lib/session-check';
import { sessionCheckInputSchema } from '../lib/session-check-input';
import { Witnesses } from './witnesses';

const CANVAS = buildSessionCheck(sessionCheckInputSchema.parse(CANVAS_SESSION));
const text = (html: string): string => html.replace(/<[^>]+>/g, '');

describe('Witnesses', () => {
  const html = renderToStaticMarkup(<Witnesses check={CANVAS} />);

  it('lists who watched with the trust behind their records, then who was missing', () => {
    expect(text(html)).toContain('Witnesses · 5 connected · 1 missing');
    expect(text(html)).toContain('GitHub11 events observedthird-party');
    expect(text(html)).toContain('Local git4 events observedlocal');
    expect(text(html)).toContain('Secrets managerNot connected');
    expect(html.match(/data-state="connected"/g)).toHaveLength(5);
    expect(html).toMatch(/border-dashed border-line-strong" data-state="missing"/);
    expect(html.match(/data-trust="local"/g)).toHaveLength(1);
  });

  it('agrees in number for a witness that saw one event', () => {
    const one = {
      ...CANVAS,
      witnesses: [
        {
          state: 'connected' as const,
          system: 'github',
          trust: 'third-party' as const,
          observed: 1,
        },
      ],
    };
    const single = text(renderToStaticMarkup(<Witnesses check={one} />));
    expect(single).toContain('1 event observed');
    expect(single).toContain('1 connected · 0 missing');
  });
});
