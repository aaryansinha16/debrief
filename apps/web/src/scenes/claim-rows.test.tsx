import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CANVAS_SESSION } from '../lib/__fixtures__/canvas-claims';
import { all, input } from '../lib/__fixtures__/mixed-session';
import { type ClaimView, buildSessionCheck } from '../lib/session-check';
import { sessionCheckInputSchema } from '../lib/session-check-input';
import { ClaimList, ClaimRow } from './claim-rows';

const CANVAS = buildSessionCheck(sessionCheckInputSchema.parse(CANVAS_SESSION));
const MIXED = buildSessionCheck(input(all));
const text = (html: string): string => html.replace(/<[^>]+>/g, '');
const rows = (html: string): string[] => html.split('<li ').slice(1);

describe('ClaimList', () => {
  const html = renderToStaticMarkup(<ClaimList check={CANVAS} />);

  it('lists the seven canvas claims under the three columns, contradictions first', () => {
    expect(html).toContain('<h2 id="claims-heading" class="sr-only">Claims checked</h2>');
    expect(text(html)).toContain('The agent saidThe checkThe world recorded');
    expect(rows(html).map((row) => /data-state="([^"]+)"/.exec(row)?.[1])).toEqual([
      'contradicted',
      'contradicted',
      'holds',
      'holds',
      'holds',
      'holds',
      'no-witness',
    ]);
    expect(html.match(/row-contradicted/g)).toHaveLength(2);
  });

  it('keeps every claim derived and every piece of evidence observed, never merged', () => {
    const [tests] = rows(html);
    expect(text(tests ?? '')).toContain('The agent said: “All 142 tests pass.”');
    expect(text(tests ?? '')).toContain('◇ derived claim · said 14:27:40');
    expect(text(tests ?? '')).toContain(
      '● observed · Forge · acme/billing-api/actions/runs/4182 · 14:28:55',
    );
    expect(text(tests ?? '')).toContain('◇ derived · Claimed 142 passing');
    expect(html.match(/data-testid="verdict"/g)).toHaveLength(7);
  });

  it('lights the rows that hold one after another, after the ring has drawn', () => {
    expect(html.match(/animation-delay:[\d.]+s/g)).toEqual([
      'animation-delay:1.2s',
      'animation-delay:1.8s',
      'animation-delay:2.4s',
      'animation-delay:3s',
    ]);
  });

  it('labels the claim backed by the local diff, names the missing witness and keeps the revision', () => {
    const [, , , , deploy, flag, key] = rows(html);
    expect(flag).toContain('data-testid="verdict-local"');
    expect(text(flag ?? '')).toContain('· local');
    expect(text(key ?? '')).toContain('Secrets manager is not connected.');
    expect(text(key ?? '')).toContain('no witness · Secrets manager not connected');
    expect(text(deploy ?? '')).toContain('revised 14:33:10 · was no witness');
  });
});

describe('ClaimRow', () => {
  const row = (claim: ClaimView): string =>
    renderToStaticMarkup(<ClaimRow claim={claim} delay={0} offset={0} />);
  const find = (state: string): ClaimView => {
    const claim = MIXED.claims.find((candidate) => candidate.state === state);
    if (claim === undefined) throw new Error(state);
    return claim;
  };

  it('shows a hedged claim, unscored and without its verdict', () => {
    const html = row(find('hedged'));
    expect(text(html)).toContain('◇ derived claim · hedged · said');
    expect(text(html)).toContain('Not scored');
    expect(text(html)).toContain('Hedged, so never scored.');
    expect(html).not.toContain('data-testid="verdict"');
  });

  it('shows a claim not checked yet without a verdict', () => {
    const html = row(find('pending'));
    expect(text(html)).toContain('Not checked');
    expect(text(html)).toContain('Not checked yet.');
    expect(html).not.toContain('data-testid="verdict"');
  });

  it('says when a connected witness recorded nothing that settles a claim', () => {
    const unseen = find('no-witness');
    const html = row({ ...unseen, witness: 'connected' });
    expect(text(html)).toContain('No record settles it.');
    expect(text(html)).toContain('no witness · Secrets manager connected');
  });

  it('falls back to the event kind and an unknown system when a record is bare', () => {
    const held = find('holds');
    const verdict = held.verdict;
    if (verdict === undefined) throw new Error('holds without a verdict');
    const bare = { id: verdict.id, kind: 'world.change' as const, at: verdict.at };
    const html = row({
      ...held,
      verdict: { ...verdict, evidence: [{ ...bare, trust: 'third-party' }] },
    });
    expect(text(html)).toContain('world.change');
    expect(text(html)).toContain('● observed · unknown · ');
  });
});
