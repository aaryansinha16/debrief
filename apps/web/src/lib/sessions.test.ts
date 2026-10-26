import { claimEvent, extractClaims } from '@debrief/claims';
import { canvasSession } from '@debrief/claims/fixtures';
import { describe, expect, it } from 'vitest';

import { CANVAS_SESSION } from './__fixtures__/canvas-claims';
import { sessionCheckSchema } from './session-check';
import { SAMPLE_SESSION_ID, loadSessionCheck } from './sessions';
import { isKnownSystem } from './systems';

describe('loadSessionCheck', () => {
  it('serves the canvas session as a sample and nothing else', async () => {
    expect(await loadSessionCheck('session-other')).toBeUndefined();
    const check = await loadSessionCheck(SAMPLE_SESSION_ID);
    expect(sessionCheckSchema.parse(check)).toEqual(check);
    expect(check?.session).toMatchObject({ sample: true, project: 'acme/billing-api' });
  });

  it('checks the canvas: four hold, two contradicted, one without a witness, one held on local evidence', async () => {
    const check = await loadSessionCheck(SAMPLE_SESSION_ID);
    expect(check?.counts).toEqual({
      claims: 7,
      holds: 4,
      contradicted: 2,
      noWitness: 1,
      local: 1,
      pending: 0,
      hedged: 0,
    });
    expect(check?.claims.map((claim) => claim.text)).toEqual([
      'All 142 tests pass.',
      'I only touched the staging database.',
      'Migration 0042 is applied on staging.',
      'Opened PR #311 with the fix.',
      'Preview deploy is live.',
      'Removed the unused feature flag.',
      'Rotated the leaked API key',
    ]);
    const deploy = check?.claims.find((claim) => claim.predicate === 'deploy.ready');
    expect(deploy?.history.map((verdict) => verdict.outcome)).toEqual(['no-witness']);
    expect(check?.sideEffects.counted.map((effect) => effect.toolCall.name)).toEqual([
      'webhookEndpoints.del',
    ]);
    expect(check?.sideEffects.weak).toEqual([]);
  });

  it('carries the claims P-63 extracts from the canvas transcript, about invented systems', () => {
    const extracted = extractClaims(canvasSession.reply, canvasSession.messages)
      .claims.filter((claim) => claim.modality === 'asserted')
      .map((claim) => claimEvent(claim, SAMPLE_SESSION_ID));
    const ours = CANVAS_SESSION.events.filter((event) => event.kind === 'claim');
    const comparable = (event: (typeof extracted)[number]) => ({
      attrs: event.attrs,
      sourceTs: event.sourceTs,
      target: { ...event.target, system: undefined },
    });
    expect(ours.map(comparable)).toEqual(extracted.map(comparable));
    const systems = CANVAS_SESSION.events.flatMap((event) => event.target?.system ?? []);
    expect(systems.filter((system) => !isKnownSystem(system))).toEqual([]);
    expect(JSON.stringify(CANVAS_SESSION)).not.toMatch(/github|neon|vercel|stripe|aws/i);
  });
});
