import { COLORS } from '@debrief/ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { all, input } from '../lib/__fixtures__/mixed-session';
import { buildSessionCheck } from '../lib/session-check';
import { IntegrityRing, arcPath } from './integrity-ring';

const text = (html: string): string => html.replace(/<[^>]+>/g, '');

describe('arcPath', () => {
  it('starts at the top, runs clockwise and stops short so neighbouring caps never touch', () => {
    expect(arcPath(0, 0.5)).toBe('M 171.98 32.56 A 128 128 0 0 1 171.98 287.44');
    expect(arcPath(0.5, 1)).toBe('M 148.02 287.44 A 128 128 0 0 1 148.02 32.56');
    expect(arcPath(0, 1)).toBe('M 171.98 32.56 A 128 128 0 1 1 148.02 32.56');
  });

  it('keeps a sliver of an arc when a claim gets less room than its caps', () => {
    expect(arcPath(0, 0.01)).toBe('M 162.01 32.02 A 128 128 0 0 1 166.03 32.14');
  });
});

describe('IntegrityRing', () => {
  const check = buildSessionCheck(input(all));
  const html = renderToStaticMarkup(<IntegrityRing arcs={check.ring} counts={check.counts} />);

  it('draws an arc per scored claim in its verdict colour, no witness dashed, each a beat after the last', () => {
    expect(html.match(/class="ring-arc(-dashed)?"/g)).toHaveLength(5);
    expect(html.match(/data-outcome="holds"/g)).toHaveLength(3);
    expect(html).toContain(`color:${COLORS.contradicted}`);
    expect(html).toMatch(
      /stroke-linecap="butt" class="ring-arc-dashed"[^>]*data-outcome="no-witness"/,
    );
    expect(html.match(/class="ring-arc"/g)).toHaveLength(4);
    expect(html).toContain('animation-delay:0.36s');
    expect(html.match(/data-local="true"/g)).toHaveLength(1);
  });

  it('names the counts for assistive tech and shows them in words beside the ring', () => {
    expect(html).toContain(
      'aria-label="3 of 5 claims hold, 1 contradicted, 1 without a witness; 1 backed only by local evidence"',
    );
    expect(text(html)).toContain('3/5claims hold');
    expect(text(html)).toContain('3 hold1 contradicted?1 no witness1 on local evidence only');
    expect(html.match(/data-testid="verdict-icon"/g)).toHaveLength(3);
  });

  it('agrees in number and leaves the local note out when nothing rests on local evidence', () => {
    const one = { ...check.counts, claims: 1, holds: 1, contradicted: 0, noWitness: 0, local: 0 };
    const single = renderToStaticMarkup(<IntegrityRing arcs={[]} counts={one} />);
    expect(text(single)).toContain('1/1claim holds');
    expect(text(single)).toContain('1 holds');
    expect(single).not.toContain('local evidence');
  });
});
