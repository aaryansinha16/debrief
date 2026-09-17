import type { Authority, Target } from './event.js';

const segments = (value: string): string[] => value.split(':');

// `staging:credentials` covers `staging:credentials:rotate`; `staging:*` covers anything under staging.
export function scopeCovers(scope: string, permission: string): boolean {
  const s = segments(scope);
  const p = segments(permission);
  for (let index = 0; index < s.length; index += 1) {
    if (s[index] === '*') return true;
    if (s[index] !== p[index]) return false;
  }
  return true;
}

export function permissionsExceedingScope(
  scope: readonly string[],
  permissions: readonly string[],
): string[] {
  return permissions.filter((permission) => !scope.some((entry) => scopeCovers(entry, permission)));
}

// production:volumes:deleteVolume — environment, resource class (path segment before the id), operation.
export function targetDescriptor(target: Target): string | undefined {
  const path = target.resource?.split('/') ?? [];
  const resourceClass = path.length >= 2 ? path[path.length - 2] : path[0];
  if (target.environment === undefined && resourceClass === undefined) return undefined;
  return [target.environment ?? 'unknown', resourceClass ?? '*', target.operation ?? '*'].join(':');
}

export type ScopeMismatchSeverity = 'minor' | 'major';

export interface ScopeMismatch {
  scope: string[];
  permissions: string[];
  excess: string[];
  targetOutsideScope?: string;
  severity: ScopeMismatchSeverity;
}

// Major when a permission is a wildcard or leaves every scope's first segment, or the target falls outside the scope.
export function scopeMismatchOf(authority: Authority, target?: Target): ScopeMismatch | undefined {
  const scope = authority.scope ?? [];
  const permissions = authority.permissions ?? [];
  const excess = permissionsExceedingScope(scope, permissions);
  const descriptor = target === undefined ? undefined : targetDescriptor(target);
  const outside =
    descriptor !== undefined &&
    scope.length > 0 &&
    !scope.some((entry) => scopeCovers(entry, descriptor))
      ? descriptor
      : undefined;
  if (excess.length === 0 && outside === undefined) return undefined;
  const major =
    outside !== undefined ||
    excess.some(
      (permission) =>
        permission.includes('*') ||
        !scope.some((entry) => segments(entry)[0] === segments(permission)[0]),
    );
  const mismatch: ScopeMismatch = {
    scope: [...scope],
    permissions: [...permissions],
    excess,
    severity: major ? 'major' : 'minor',
  };
  if (outside !== undefined) mismatch.targetOutsideScope = outside;
  return mismatch;
}
