import type { Target } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import {
  SHA_A,
  SHA_B,
  SHA_HUMAN,
  WINDOW,
  claim,
  gitState,
  ist,
  witness,
} from '../__fixtures__/index.js';
import { verdicts } from '../check.js';

const at = ist('14:20:00');
const base = gitState(9, ist('14:10:30'), SHA_HUMAN, []);
const git = gitState(10, ist('14:15:00'), SHA_B, []);
const one = (events: Parameters<typeof verdicts>[0]['events']) =>
  verdicts({ events, window: WINDOW })[0]!;
const said = (predicate: string, subject: Target, params: Record<string, string | number> = {}) =>
  claim({ n: 1, at, text: 'said', predicate, subject, params });
const neon = (
  n: number,
  target: Omit<Target, 'system'>,
  attrs = {},
  kind: 'world.change' | 'world.read' = 'world.change',
  actor?: { type: 'human' | 'system'; id: string },
) =>
  witness({
    n,
    at,
    kind,
    target: { system: 'neon', ...target },
    attrs,
    summary: `neon ${target.operation ?? ''} ${target.environment ?? ''}`.trim(),
    ...(actor === undefined ? {} : { actor }),
  });

describe('db.scope', () => {
  const scope = said(
    'db.scope',
    { system: 'neon', environment: 'staging' },
    { environment: 'staging' },
  );

  it('is contradicted by one change outside the named environment that is not a human’s', () => {
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

  it('never holds from silence, and does not blame a colleague’s change', () => {
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
    const carol = neon(13, { environment: 'production', operation: 'update' }, {}, 'world.change', {
      type: 'human',
      id: 'carol-rev',
    });
    expect(one([scope, staging, carol])).toMatchObject({
      outcome: 'no-witness',
      reason:
        'neon recorded 1 changes on staging; the changes elsewhere were by carol-rev (human), not the session, but no witness attests coverage of its other environments for the window',
    });
    expect(
      one([said('db.scope', { system: 'neon', environment: 'staging' }), staging]).outcome,
    ).toBe('no-witness');
    expect(one([said('db.scope', { system: 'neon' }), staging]).reason).toBe(
      'the claim names no environment to hold it to',
    );
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

  it('holds on an applied migration naming the migration in its attrs, resource or summary', () => {
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
      ...neon(13, { environment: 'staging', operation: 'migration.completed' }),
      summary: 'applied 0042',
    };
    expect(one([applied, bySummary]).outcome).toBe('holds');
  });

  it('is contradicted by a failed migration of that name, and waits on anything less', () => {
    expect(one([applied]).reason).toBe(
      'nothing is watching neon: connect a witness and migrations get checked',
    );
    const failed = neon(
      11,
      { environment: 'staging', operation: 'migration.failed' },
      { 'db.migration': '0042' },
    );
    expect(one([applied, failed])).toMatchObject({
      outcome: 'contradicted',
      evidence: [failed.id],
    });
    const prod = neon(
      12,
      { environment: 'production', operation: 'migration.applied' },
      { 'db.migration': '0042' },
    );
    const lookalike = neon(
      13,
      { environment: 'staging', operation: 'migration.applied' },
      { 'db.migration': '00421' },
    );
    const read = neon(
      14,
      { environment: 'staging', operation: 'migration.applied' },
      { 'db.migration': '0042' },
      'world.read',
    );
    const update = neon(
      15,
      { environment: 'staging', operation: 'update' },
      { 'db.migration': '0042' },
    );
    expect(one([applied, prod, lookalike, read, update])).toMatchObject({
      outcome: 'no-witness',
      reason: 'neon recorded no migration 0042 applied on staging in the window',
    });
    expect(
      one([said('migration.applied', { system: 'neon' }, { name: '0042' }), update]).reason,
    ).toBe('the claim names no environment to check it on');
    expect(
      one([
        said('migration.applied', { system: 'neon', environment: 'staging' }, { name: ' ' }),
        update,
      ]).reason,
    ).toBe('the claim names no migration');
  });
});

describe('deploy.ready', () => {
  const vercel = (n: number, environment: Target['environment'], operation: string, sha = SHA_B) =>
    witness({
      n,
      at,
      target: { system: 'vercel', environment, operation },
      attrs: { 'commit.sha': sha },
      summary: `${operation} ${environment ?? ''}`,
    });
  const deploy = (target?: string) =>
    said('deploy.ready', { system: 'vercel' }, target === undefined ? {} : { target });

  it('holds on a ready or promoted deployment of a session commit in the claimed target', () => {
    const preview = vercel(11, 'staging', 'deployment.ready');
    const prod = vercel(12, 'production', 'deployment.promoted');
    expect(one([deploy('preview'), base, git, preview, prod])).toMatchObject({
      outcome: 'holds',
      evidence: [preview.id],
    });
    expect(one([deploy('production'), base, git, preview, prod])).toMatchObject({
      outcome: 'holds',
      evidence: [prod.id],
    });
    expect(one([deploy(), base, git, preview, prod]).evidence).toEqual([preview.id, prod.id]);
  });

  it('is contradicted by a failed deployment of a session commit, else waits naming the target', () => {
    const errored = vercel(11, 'production', 'deployment.error');
    const created = vercel(12, 'production', 'deployment.created');
    const theirs = vercel(13, 'production', 'deployment.ready', SHA_HUMAN);
    expect(one([deploy('production'), base, git, errored, created, theirs])).toMatchObject({
      outcome: 'contradicted',
      evidence: [errored.id],
    });
    expect(one([deploy('preview'), base, git, errored, created]).reason).toBe(
      "vercel recorded no preview deployment ready for this session's commits in the window",
    );
    expect(one([deploy(), base, git, created]).reason).toBe(
      "vercel recorded no deployment ready for this session's commits in the window",
    );
    expect(one([deploy()]).reason).toBe(
      'nothing is watching vercel: connect a witness and deployments get checked',
    );
    expect(one([deploy(), theirs]).reason).toMatch(/^no local git witness/);
    expect(one([deploy(), base, theirs]).reason).toBe(
      "the session's HEAD stayed at c0ffee5, the commit it started from; no deployment is bound to it",
    );
  });
});

describe('secret.rotated', () => {
  const vault = (
    n: number,
    operation: string,
    resource?: string,
    summary = 'rotated a key',
    human = false,
  ) =>
    witness({
      n,
      at,
      target: { system: 'secrets', operation, ...(resource === undefined ? {} : { resource }) },
      summary,
      ...(human ? { actor: { type: 'human' as const, id: 'carol-rev' } } : {}),
    });

  it('holds on the session’s rotation of the named secret, is contradicted by its failure, else waits', () => {
    const rotated = vault(11, 'secret.rotated', 'billing/api-key');
    expect(
      one([said('secret.rotated', { system: 'secrets' }, { name: 'API key' }), rotated]),
    ).toMatchObject({
      outcome: 'holds',
      evidence: [rotated.id],
    });
    expect(
      one([said('secret.rotated', { system: 'secrets', resource: 'api-key' }), rotated]).outcome,
    ).toBe('holds');
    expect(
      one([
        said('secret.rotated', { system: 'secrets' }, { name: 'a key' }),
        vault(12, 'rotation.completed'),
      ]).outcome,
    ).toBe('holds');
    const failed = vault(13, 'rotation.failed', 'billing/db-pass');
    expect(
      one([said('secret.rotated', { system: 'secrets' }, { name: 'db-pass' }), failed]),
    ).toMatchObject({
      outcome: 'contradicted',
      evidence: [failed.id],
    });
    expect(
      one([said('secret.rotated', { system: 'secrets' }, { name: 'db-pass' }), rotated]).reason,
    ).toBe('secrets recorded no rotation of db-pass by the session in the window');
    const carol = vault(14, 'secret.rotated', 'billing/api-key', 'carol rotated it', true);
    expect(
      one([said('secret.rotated', { system: 'secrets' }, { name: 'api-key' }), carol]).outcome,
    ).toBe('no-witness');
    expect(
      one([
        said('secret.rotated', { system: 'secrets' }, { name: 'api-key' }),
        vault(15, 'rotation.requested', 'billing/api-key'),
      ]).outcome,
    ).toBe('no-witness');
    expect(one([said('secret.rotated', { system: 'secrets' }), rotated]).reason).toBe(
      'the claim names no secret',
    );
    expect(one([said('secret.rotated', { system: 'secrets' })]).reason).toBe(
      'nothing is watching secrets: connect a witness and claims like this get checked',
    );
    expect(SHA_A).toHaveLength(40);
  });
});
