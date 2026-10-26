import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CANVAS_SESSION } from '../lib/__fixtures__/canvas-claims';
import { all, input } from '../lib/__fixtures__/mixed-session';
import { type ClaimView, buildSessionCheck } from '../lib/session-check';
import { sessionCheckInputSchema } from '../lib/session-check-input';
import { ClaimWorld, ClaimRow, ClaimList } from './claim-rows';

const CANVAS = buildSessionCheck(sessionCheckInputSchema.parse(CANVAS_SESSION));
const MIXED = buildSessionCheck(input(all));
const text = (html: string): string => html.replace(/<[^>]+>/g, '');
const rows = (html: string): string[] => html.split('<li ').slice(1);
const find = (claims: readonly ClaimView[], match: (claim: ClaimView) => boolean): ClaimView => {
  const claim = claims.find(match);
  if (claim === undefined) throw new Error('no such claim');
  return claim;
};
const inState = (state: string): ClaimView => find(MIXED.claims, (claim) => claim.state === state);

describe('ClaimWorld', () => {
  const world = (claim: ClaimView): string =>
    text(renderToStaticMarkup(<ClaimWorld claim={claim} offset={330} />));

  it('shows what the witness recorded as observed and the reading of it as derived, never merged', () => {
    const tests = world(find(CANVAS.claims, (claim) => claim.predicate === 'tests.passed'));
    expect(tests).toContain('CI run #4182: 139 passed, 3 skipped, 0 failed');
    expect(tests).toContain('● observed · Forge · acme/billing-api/pipelines/4182 · 14:28:55');
    expect(tests).toContain('◇ derived · Claimed 142 passing');
    const flag = world(find(CANVAS.claims, (claim) => claim.predicate === 'code.removed'));
    expect(flag).toContain('· 14:18:40 · local');
  });

  it('names a missing witness, and says when a connected one recorded nothing, both as derived', () => {
    const key = world(find(CANVAS.claims, (claim) => claim.state === 'no-witness'));
    expect(key).toContain('Secrets manager is not connected.');
    expect(key).toContain('◇ derived · no witness · Secrets manager not connected');
    const quiet = world({ ...inState('no-witness'), witness: 'connected' });
    expect(quiet).toContain('No record settles it.');
    expect(quiet).toContain('◇ derived · no witness · Secrets manager connected');
  });

  it('says a hedged claim is never scored and an unchecked one is not checked yet', () => {
    expect(world(inState('hedged'))).toBe('Hedged, so never scored.');
    expect(world(inState('pending'))).toBe('Not checked yet.');
  });

  it('falls back to the event kind and an unknown system when a record is bare', () => {
    const held = inState('holds');
    const verdict = held.verdict;
    if (verdict === undefined) throw new Error('holds without a verdict');
    const bare = { id: verdict.id, kind: 'world.change' as const, at: verdict.at };
    const html = world({
      ...held,
      verdict: { ...verdict, evidence: [{ ...bare, trust: 'third-party' }] },
    });
    expect(html).toContain('world.change');
    expect(html).toContain('● observed · unknown · ');
  });
});

describe('ClaimRow', () => {
  const row = (claim: ClaimView): string =>
    renderToStaticMarkup(<ClaimRow claim={claim} delay={0} offset={330} />);

  it('quotes the claim with its derived label, its beam and verdict, and what the world recorded', () => {
    const html = row(find(CANVAS.claims, (claim) => claim.predicate === 'tests.passed'));
    expect(text(html)).toContain('The agent said: “All 142 tests pass.”');
    expect(text(html)).toContain('◇ derived claim · said 14:27:40');
    expect(html).toContain('data-beam="contradicted"');
    expect(html).toContain('data-outcome="contradicted"');
    expect(html).toContain('row-contradicted');
    expect(text(html)).toContain('The world recorded: CI run #4182');
  });

  it('labels a verdict the local diff alone backs, and keeps the one it revised', () => {
    const flag = row(find(CANVAS.claims, (claim) => claim.predicate === 'code.removed'));
    expect(flag).toContain('data-testid="verdict-local"');
    const deploy = row(find(CANVAS.claims, (claim) => claim.predicate === 'deploy.ready'));
    expect(text(deploy)).toContain('revised 14:33:10 · was no witness');
    expect(deploy).not.toContain('row-contradicted');
  });

  it('shows a hedged or unchecked claim without a verdict', () => {
    const hedged = row(inState('hedged'));
    expect(text(hedged)).toContain('◇ derived claim · hedged · said');
    expect(text(hedged)).toContain('Not scored');
    expect(hedged).not.toContain('data-testid="verdict"');
    const pending = row(inState('pending'));
    expect(text(pending)).toContain('Not checked');
    expect(pending).not.toContain('data-testid="verdict"');
  });
});

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
    expect(html.match(/data-testid="verdict"/g)).toHaveLength(7);
  });

  it('starts every beam after the ring has drawn, the rows that hold one after another', () => {
    expect(html.match(/animation-delay:[\d.]+s/g)).toEqual([
      'animation-delay:1.2s',
      'animation-delay:1.2s',
      'animation-delay:1.2s',
      'animation-delay:1.8s',
      'animation-delay:2.4s',
      'animation-delay:3s',
    ]);
  });
});
