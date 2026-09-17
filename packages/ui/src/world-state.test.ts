import { describe, expect, it } from 'vitest';

import { ev } from './__fixtures__/synthetic-run.js';
import { EMPTY_WORLD, applyEvent } from './world-state.js';

describe('applyEvent', () => {
  it('tracks resources by observed field changes without mutating the previous state', () => {
    const first = applyEvent(
      EMPTY_WORLD,
      ev(0, 0, {
        kind: 'world.change',
        target: {
          system: 'orbital',
          resource: 'projects/p/volumes/v',
          environment: 'production',
          operation: 'deleteVolume',
        },
        attrs: { 'world.field': 'backupExists', 'world.before': true, 'world.after': false },
      }),
    );
    const second = applyEvent(
      first,
      ev(1, 10, {
        kind: 'world.change',
        target: { system: 'orbital', resource: 'projects/p/volumes/v' },
        attrs: { 'world.field': 'sizeGb', 'world.after': 0 },
      }),
    );
    expect(first.resources['orbital:projects/p/volumes/v']).toEqual({
      system: 'orbital',
      resource: 'projects/p/volumes/v',
      environment: 'production',
      fields: { backupExists: false },
      lastOperation: 'deleteVolume',
      lastEventId: first.lastEventId,
      mutations: 1,
    });
    expect(second.resources['orbital:projects/p/volumes/v']).toMatchObject({
      environment: 'production',
      lastOperation: 'deleteVolume',
      fields: { backupExists: false, sizeGb: 0 },
      mutations: 2,
    });
    expect(first.resources['orbital:projects/p/volumes/v']?.fields).toEqual({
      backupExists: false,
    });
    expect(second.counts).toEqual({ 'world.change': 2 });
    expect(second.applied).toBe(2);
    const unlabelled = applyEvent(
      EMPTY_WORLD,
      ev(2, 0, { kind: 'world.change', target: { system: 'orbital', resource: 'r' } }),
    );
    expect(unlabelled.resources['orbital:r']?.fields).toEqual({});
    expect(unlabelled.resources['orbital:r']).not.toHaveProperty('environment');
    expect(
      applyEvent(EMPTY_WORLD, ev(3, 0, { kind: 'world.change', target: { system: 'orbital' } }))
        .resources,
    ).toEqual({});
  });

  it('tracks tokens through grants and revocations', () => {
    const grant = ev(0, 0, {
      kind: 'delegation.grant',
      actor: { type: 'human', id: 'human:pat' },
      authority: { principalId: 'human:pat', tokenRef: 'tok', scope: ['a'], permissions: ['a:x'] },
      attrs: { 'delegation.to': 'agent:worker', 'delegation.token.label': 'deploy' },
    });
    const revoke = ev(1, 5, {
      kind: 'delegation.revoke',
      authority: { principalId: 'human:pat', grantId: 'tok' },
    });
    const state = applyEvent(applyEvent(EMPTY_WORLD, grant), revoke);
    expect(state.tokens.tok).toEqual({
      tokenRef: 'tok',
      principalId: 'human:pat',
      holder: 'agent:worker',
      label: 'deploy',
      scope: ['a'],
      permissions: ['a:x'],
      grantedBy: 'human:pat',
      revoked: true,
    });
    expect(state.counts).toEqual({ 'delegation.grant': 1, 'delegation.revoke': 1 });
    const bare = applyEvent(
      EMPTY_WORLD,
      ev(2, 0, { kind: 'delegation.grant', authority: { principalId: 'p' } }),
    );
    expect(bare.tokens).toEqual({});
    const anonymous = applyEvent(
      EMPTY_WORLD,
      ev(3, 0, { kind: 'delegation.grant', authority: { principalId: 'p', grantId: 'g' } }),
    );
    expect(anonymous.tokens.g).toEqual({
      tokenRef: 'g',
      principalId: 'p',
      scope: [],
      permissions: [],
      grantedBy: 'agent:worker',
      revoked: false,
    });
    expect(applyEvent(EMPTY_WORLD, ev(4, 0, { kind: 'llm.call' })).counts).toEqual({
      'llm.call': 1,
    });
  });
});
