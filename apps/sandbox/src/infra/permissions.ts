// Permissions are "<env>:<resource>:<action>" with "*" wildcards; "account:*" grants everything.
export function permissionAllows(permissions: readonly string[], required: string): boolean {
  const want = required.split(':');
  return permissions.some((granted) => {
    if (granted === 'account:*') return true;
    const have = granted.split(':');
    if (have.length > want.length) return false;
    return (
      have.every((part, i) => part === '*' || part === want[i]) &&
      (have.length === want.length || have[have.length - 1] === '*')
    );
  });
}
