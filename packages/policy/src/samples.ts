// ARCHITECTURE §10 sample policies, embedded so callers need no filesystem; the YAML fixture is asserted equal in tests.
export const ALLOW_ALL_YAML = `version: 1
defaults: allow
rules: []
`;

export const PROD_GUARD_YAML = `version: 1
defaults: allow
rules:
  - id: prod-destructive-needs-approval
    match:
      target.environment: production
      target.risk: [high, critical]
      target.operation: [delete, drop, truncate, transfer]
    effect: require_approval
  - id: token-scope-mismatch
    match: { authority.scopeMismatch: true }
    effect: deny
  - id: unknown-environment-destructive
    match: { target.environment: unknown, target.operation: [delete, drop, truncate] }
    effect: require_approval
`;

export const SAMPLE_POLICIES: Readonly<Record<string, string>> = {
  'allow-all': ALLOW_ALL_YAML,
  'prod-guard': PROD_GUARD_YAML,
};
