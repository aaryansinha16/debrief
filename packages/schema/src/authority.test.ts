import { describe, expect, it } from 'vitest';

import {
  permissionsExceedingScope,
  scopeCovers,
  scopeMismatchOf,
  targetDescriptor,
} from './authority.js';

describe('scope matching', () => {
  it('covers by colon-separated prefix with wildcards', () => {
    expect(scopeCovers('staging:credentials', 'staging:credentials:rotate')).toBe(true);
    expect(scopeCovers('staging:*', 'staging:files:read')).toBe(true);
    expect(scopeCovers('staging:credentials', 'staging:files:read')).toBe(false);
    expect(scopeCovers('staging:credentials:read', 'staging:credentials')).toBe(false);
    expect(permissionsExceedingScope(['staging:*'], ['staging:a', 'prod:b'])).toEqual(['prod:b']);
  });

  it('describes targets as environment:class:operation', () => {
    expect(targetDescriptor({ system: 'orbital' })).toBeUndefined();
    expect(targetDescriptor({ system: 'orbital', environment: 'staging' })).toBe('staging:*:*');
    expect(targetDescriptor({ system: 'orbital', resource: 'bucket', operation: 'read' })).toBe(
      'unknown:bucket:read',
    );
    expect(
      targetDescriptor({
        system: 'orbital',
        resource: 'projects/p/volumes/v',
        environment: 'production',
        operation: 'deleteVolume',
      }),
    ).toBe('production:volumes:deleteVolume');
  });
});

describe('scopeMismatchOf', () => {
  const staging = {
    principalId: 'human:pat',
    scope: ['staging:credentials'],
    permissions: ['staging:credentials:read', 'staging:credentials:rotate', 'staging:files:read'],
  };
  const account = {
    principalId: 'human:pat',
    scope: ['staging:credentials'],
    permissions: ['account:*'],
  };
  const production = {
    system: 'orbital',
    resource: 'projects/p/volumes/v',
    environment: 'production',
    operation: 'deleteVolume',
  } as const;

  it('grades excess inside the scope namespace as minor', () => {
    expect(scopeMismatchOf(staging)).toEqual({
      scope: ['staging:credentials'],
      permissions: staging.permissions,
      excess: ['staging:files:read'],
      severity: 'minor',
    });
    expect(
      scopeMismatchOf({
        principalId: 'p',
        scope: ['staging:credentials'],
        permissions: ['staging:credentials:read'],
      }),
    ).toBeUndefined();
    expect(scopeMismatchOf({ principalId: 'p' })).toBeUndefined();
  });

  it('grades wildcards, foreign namespaces and targets outside the scope as major', () => {
    expect(scopeMismatchOf(account)).toMatchObject({ excess: ['account:*'], severity: 'major' });
    expect(
      scopeMismatchOf({
        principalId: 'p',
        scope: ['staging:credentials'],
        permissions: ['prod:db:read'],
      }),
    ).toMatchObject({ excess: ['prod:db:read'], severity: 'major' });
    expect(scopeMismatchOf(account, production)).toEqual({
      scope: ['staging:credentials'],
      permissions: ['account:*'],
      excess: ['account:*'],
      targetOutsideScope: 'production:volumes:deleteVolume',
      severity: 'major',
    });
    expect(
      scopeMismatchOf(
        {
          principalId: 'p',
          scope: ['staging:credentials'],
          permissions: ['staging:credentials:read'],
        },
        production,
      ),
    ).toMatchObject({
      excess: [],
      targetOutsideScope: 'production:volumes:deleteVolume',
      severity: 'major',
    });
    expect(
      scopeMismatchOf(
        {
          principalId: 'p',
          scope: ['production:volumes'],
          permissions: ['production:volumes:delete'],
        },
        production,
      ),
    ).toBeUndefined();
    expect(
      scopeMismatchOf({ principalId: 'p', scope: [], permissions: ['x'] }, production),
    ).toMatchObject({ severity: 'major' });
    expect(
      scopeMismatchOf(
        { principalId: 'p', scope: ['staging:*'], permissions: [] },
        { system: 'orbital' },
      ),
    ).toBeUndefined();
  });
});
