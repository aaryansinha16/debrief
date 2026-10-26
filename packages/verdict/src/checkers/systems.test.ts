import type { Target } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import { WINDOW, claim, ist, witness } from '../__fixtures__/index.js';
import { verdicts } from '../check.js';

const at = ist('14:20:00');
const one = (events: Parameters<typeof verdicts>[0]['events']) =>
  verdicts({ events, window: WINDOW })[0]!;
const said = (predicate: string, subject: Target, params: Record<string, string | number> = {}) =>
  claim({ n: 1, at, text: 'said', predicate, subject, params });
const neon = (
  n: number,
  target: Omit<Target, 'system'>,
  attrs = {},
  kind: 'world.change' | 'world.read' = 'world.change',
) =>
  witness({
    n,
    at,
    kind,
    target: { system: 'neon', ...target },
    attrs,
    summary: `neon ${target.operation ?? ''} ${target.environment ?? ''}`.trim(),
  });

describe('db.scope', () => {
  const scope = said(
    'db.scope',
    { system: 'neon', environment: 'staging' },
    { environment: 'staging' },
  );

  it('is contradicted by one change outside the named environment', () => {
    const prod = neon(11, { environment: 'production', operation: 'update' });
    const staging = neon(12, { environment: 'staging', operation: 'update' });
    const vague = neon(13, { operation: 'update' });
    const unknown = neon(14, { environment: 'unknown', operation: 'update' });
    const read = neon(15, { environment: 'production', operation: 'select' }, {}, 'world.read');
    expect(one([scope, staging, prod, vague, unknown, read])).toMatchObject({
      outcome: 'contradicted',
      trust: 'third-party',
      evidence: [prod.id],
      reason: 'neon recorded a change outside staging: neon update production',
    });
  });

  it('never holds from silence: it needs coverage no witness attests yet', () => {
    expect(one([scope]).reason).toBe(
      'nothing is watching neon: connect a witness and claims about its scope get checked',
    );
    const staging = neon(12, { environment: 'staging', operation: 'update' });
    expect(one([scope, staging])).toMatchObject({
      outcome: 'no-witness',
      evidence: [staging.id],
      reason:
        'neon recorded 1 changes on staging and none elsewhere, but no witness attests coverage of its other environments for the window',
    });
    const bySubject = said('db.scope', { system: 'neon', environment: 'staging' });
    expect(one([bySubject, staging]).outcome).toBe('no-witness');
    const nowhere = said('db.scope', { system: 'neon' });
    expect(one([nowhere, staging]).reason).toBe('the claim names no environment to hold it to');
    expect(
      one([said('db.scope', { system: 'neon', environment: 'unknown' }), staging]).reason,
    ).toMatch(/names no environment/);
  });
});

describe('migration.applied', () => {
  const applied = said(
    'migration.applied',
    { system: 'neon', environment: 'staging' },
    { name: '0042' },
  );

  it('holds on a migration event naming the migration in its attrs, resource or summary', () => {
    const byAttr = neon(
      11,
      { environment: 'staging', operation: 'migration.applied' },
      { 'db.migration': '0042' },
    );
    expect(one([applied, byAttr])).toMatchObject({ outcome: 'holds', evidence: [byAttr.id] });
    const byResource = neon(12, {
      environment: 'staging',
      resource: 'migrations/0042_add_index',
      operation: 'migrate',
    });
    expect(one([applied, byResource]).outcome).toBe('holds');
    const bySummary = {
      ...neon(13, { environment: 'staging', operation: 'migration.applied' }),
      summary: 'applied 0042',
    };
    expect(one([applied, bySummary]).outcome).toBe('holds');
    const nameless = said('migration.applied', { system: 'neon' });
    expect(
      one([nameless, neon(14, { environment: 'production', operation: 'migration.applied' })])
        .outcome,
    ).toBe('holds');
  });

  it('waits when the migration is elsewhere, another name, a read, or not a migration', () => {
    expect(one([applied]).reason).toBe(
      'nothing is watching neon: connect a witness and migrations get checked',
    );
    const prod = neon(
      11,
      { environment: 'production', operation: 'migration.applied' },
      { 'db.migration': '0042' },
    );
    const other = neon(
      12,
      { environment: 'staging', operation: 'migration.applied' },
      { 'db.migration': '0041' },
    );
    const read = neon(
      13,
      { environment: 'staging', operation: 'migration.applied' },
      { 'db.migration': '0042' },
      'world.read',
    );
    const update = neon(
      14,
      { environment: 'staging', operation: 'update' },
      { 'db.migration': '0042' },
    );
    expect(one([applied, prod, other, read, update])).toMatchObject({
      outcome: 'no-witness',
      reason: 'neon recorded no migration 0042 on staging in the window',
    });
    expect(one([said('migration.applied', { system: 'neon' }), update]).reason).toBe(
      'neon recorded no migration in the window',
    );
  });
});

describe('deploy.ready', () => {
  const vercel = (n: number, environment: Target['environment'], operation: string) =>
    witness({
      n,
      at,
      target: { system: 'vercel', environment, operation },
      summary: `${operation} ${environment ?? ''}`,
    });

  it('holds on a ready or promoted deployment in the claimed target', () => {
    const preview = vercel(11, 'staging', 'deployment.ready');
    const prod = vercel(12, 'production', 'deployment.promoted');
    expect(
      one([said('deploy.ready', { system: 'vercel' }, { target: 'preview' }), preview, prod]),
    ).toMatchObject({ outcome: 'holds', evidence: [preview.id] });
    expect(
      one([said('deploy.ready', { system: 'vercel' }, { target: 'production' }), preview, prod]),
    ).toMatchObject({ outcome: 'holds', evidence: [prod.id] });
    expect(one([said('deploy.ready', { system: 'vercel' }), preview, prod]).evidence).toEqual([
      preview.id,
      prod.id,
    ]);
  });

  it('is contradicted by a failed deployment, else waits naming the target', () => {
    const errored = vercel(11, 'production', 'deployment.error');
    const created = vercel(12, 'production', 'deployment.created');
    expect(
      one([said('deploy.ready', { system: 'vercel' }, { target: 'production' }), errored, created]),
    ).toMatchObject({ outcome: 'contradicted', evidence: [errored.id] });
    expect(
      one([said('deploy.ready', { system: 'vercel' }, { target: 'preview' }), errored, created])
        .reason,
    ).toBe('vercel recorded no preview deployment ready in the window');
    expect(one([said('deploy.ready', { system: 'vercel' }), created]).reason).toBe(
      'vercel recorded no deployment ready in the window',
    );
    expect(one([said('deploy.ready', { system: 'vercel' })]).reason).toBe(
      'nothing is watching vercel: connect a witness and deployments get checked',
    );
  });
});

describe('secret.rotated', () => {
  const vault = (n: number, operation: string, resource?: string, summary = 'rotated a key') =>
    witness({
      n,
      at,
      target: { system: 'secrets', operation, ...(resource === undefined ? {} : { resource }) },
      summary,
    });

  it('holds on a rotation naming the secret, else waits', () => {
    const rotated = vault(11, 'secret.rotated', 'billing/api-key');
    expect(one([said('secret.rotated', { system: 'secrets' }), rotated])).toMatchObject({
      outcome: 'holds',
      evidence: [rotated.id],
    });
    expect(
      one([said('secret.rotated', { system: 'secrets' }, { name: 'API-KEY' }), rotated]).outcome,
    ).toBe('holds');
    expect(
      one([
        said('secret.rotated', { system: 'secrets' }, { name: 'rotated a key' }),
        vault(12, 'rotate'),
      ]).outcome,
    ).toBe('holds');
    expect(
      one([said('secret.rotated', { system: 'secrets' }, { name: 'db-pass' }), rotated]).reason,
    ).toBe('secrets recorded no rotation in the window');
    expect(
      one([said('secret.rotated', { system: 'secrets' }), vault(13, 'secret.read')]).outcome,
    ).toBe('no-witness');
    expect(one([said('secret.rotated', { system: 'secrets' })]).reason).toBe(
      'nothing is watching secrets: connect a witness and claims like this get checked',
    );
  });
});
