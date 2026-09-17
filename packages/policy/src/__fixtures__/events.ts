import type { Event } from '@debrief/schema';

const ZERO = '0'.repeat(64);
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const AGENT = { type: 'agent', id: 'agent:coding-agent', name: 'coding-agent' } as const;
const INFRA = { type: 'system', id: 'orbital-infra', name: 'Orbital infra' } as const;
const STAGING_TOKEN = {
  principalId: 'human:aaryan',
  tokenRef: 'tok-stg-7f3a',
  scope: ['staging:credentials'],
  permissions: ['staging:credentials:read', 'staging:credentials:rotate', 'staging:files:read'],
};
const ACCOUNT_TOKEN = {
  principalId: 'human:aaryan',
  tokenRef: 'tok-acct-9c1d',
  scope: ['staging:credentials'],
  permissions: ['account:*'],
};
const PROD_VOLUME_TOKEN = {
  principalId: 'human:aaryan',
  tokenRef: 'tok-prod-vol',
  scope: ['production:volumes'],
  permissions: ['production:volumes:delete'],
};

const at = (seq: number): string =>
  new Date(Date.UTC(2026, 8, 17, 0, 0, 0) + seq * 1000).toISOString();
const ulid = (seq: number): string =>
  `01J8ZK5R4M2X6P9Q3V7W1Y5P${ALPHABET[Math.floor(seq / 32)] ?? '0'}${ALPHABET[seq % 32] ?? '0'}`;

const event = (seq: number, patch: Partial<Event> & Pick<Event, 'kind' | 'summary'>): Event => ({
  id: ulid(seq),
  tenantId: 'tenant-demo',
  seq,
  ts: at(seq),
  sourceTs: at(seq),
  source: 'otlp',
  provenance: 'reported',
  runId: 'policy-fixture',
  actor: AGENT,
  attrs: {},
  prevHash: ZERO,
  hash: ZERO,
  ...patch,
});

const tool = (
  seq: number,
  summary: string,
  target: Event['target'],
  extra: Partial<Event> = {},
): Event => event(seq, { kind: 'tool.call', summary, target, ...extra });

// Twenty events exercising the three ARCHITECTURE §10 rules: environment, risk, verb prefixes, scope mismatch severity and rule order.
export const POLICY_FIXTURE_EVENTS: readonly Event[] = [
  tool(0, 'production deleteVolume critical', {
    system: 'orbital',
    resource: 'projects/nova/volumes/vol-prod-01',
    environment: 'production',
    operation: 'deleteVolume',
    risk: 'critical',
  }),
  tool(1, 'production dropTable high', {
    system: 'pg',
    resource: 'public.users',
    environment: 'production',
    operation: 'dropTable',
    risk: 'high',
  }),
  tool(2, 'production truncateTable critical', {
    system: 'pg',
    resource: 'public.events',
    environment: 'production',
    operation: 'truncateTable',
    risk: 'critical',
  }),
  tool(3, 'production transferFunds high', {
    system: 'ledger',
    resource: 'accounts/acme',
    environment: 'production',
    operation: 'transferFunds',
    risk: 'high',
  }),
  tool(4, 'production deleteVolume low', {
    system: 'orbital',
    resource: 'projects/nova/volumes/vol-scratch',
    environment: 'production',
    operation: 'deleteVolume',
    risk: 'low',
  }),
  tool(5, 'production listVolumes critical', {
    system: 'orbital',
    resource: 'projects/nova/volumes',
    environment: 'production',
    operation: 'listVolumes',
    risk: 'critical',
  }),
  tool(6, 'staging deleteVolume critical', {
    system: 'orbital',
    resource: 'projects/nova/volumes/vol-stg-02',
    environment: 'staging',
    operation: 'deleteVolume',
    risk: 'critical',
  }),
  tool(7, 'production deletedItems high', {
    system: 'orbital',
    resource: 'projects/nova/trash',
    environment: 'production',
    operation: 'deletedItems',
    risk: 'high',
  }),
  tool(8, 'production DeleteVolume critical', {
    system: 'orbital',
    resource: 'projects/nova/volumes/vol-prod-02',
    environment: 'production',
    operation: 'DeleteVolume',
    risk: 'critical',
  }),
  tool(9, 'unknown deleteFile medium', {
    system: 'orbital',
    resource: 'projects/nova/files/notes.md',
    environment: 'unknown',
    operation: 'deleteFile',
    risk: 'medium',
  }),
  tool(10, 'unknown readFile low', {
    system: 'orbital',
    resource: 'projects/nova/files/notes.md',
    environment: 'unknown',
    operation: 'readFile',
    risk: 'low',
  }),
  tool(11, 'unknown truncateLog', {
    system: 'orbital',
    resource: 'projects/nova/logs/app',
    environment: 'unknown',
    operation: 'truncateLog',
  }),
  event(12, {
    kind: 'world.change',
    summary: 'staging rotateCredential with the staging token',
    source: 'world-hook',
    provenance: 'observed',
    actor: INFRA,
    authority: STAGING_TOKEN,
    target: {
      system: 'orbital',
      resource: 'projects/nova/environments/staging/credentials/DATABASE_URL',
      environment: 'staging',
      operation: 'rotateCredential',
      risk: 'medium',
    },
  }),
  event(13, {
    kind: 'world.change',
    summary: 'production deleteVolume with the account token',
    source: 'world-hook',
    provenance: 'observed',
    actor: INFRA,
    authority: ACCOUNT_TOKEN,
    target: {
      system: 'orbital',
      resource: 'projects/nova/volumes/vol-prod-01',
      environment: 'production',
      operation: 'deleteVolume',
      risk: 'critical',
    },
  }),
  event(14, {
    kind: 'delegation.grant',
    summary: 'adopted the account token',
    source: 'api',
    authority: ACCOUNT_TOKEN,
    attrs: { 'delegation.to': 'agent:coding-agent' },
  }),
  event(15, {
    kind: 'delegation.grant',
    summary: 'handed the staging token',
    source: 'api',
    actor: { type: 'human', id: 'human:aaryan', name: 'Aaryan' },
    authority: STAGING_TOKEN,
    attrs: { 'delegation.to': 'agent:coding-agent' },
  }),
  tool(
    16,
    'staging readFile with the account token',
    {
      system: 'orbital',
      resource: 'projects/nova/files/.env.backup',
      environment: 'staging',
      operation: 'readFile',
      risk: 'low',
    },
    { authority: ACCOUNT_TOKEN },
  ),
  tool(
    17,
    'staging deleteVolume within scope',
    {
      system: 'orbital',
      resource: 'projects/nova/volumes/vol-stg-02',
      environment: 'staging',
      operation: 'deleteVolume',
      risk: 'critical',
    },
    {
      authority: {
        principalId: 'human:aaryan',
        tokenRef: 'tok-stg-vol',
        scope: ['staging:*'],
        permissions: ['staging:volumes:delete'],
      },
    },
  ),
  event(18, {
    kind: 'llm.call',
    summary: 'chat turn',
    attrs: { 'gen_ai.request.model': 'atlas-4' },
  }),
  tool(
    19,
    'production deleteVolume within a production scope',
    {
      system: 'orbital',
      resource: 'projects/nova/volumes/vol-prod-03',
      environment: 'production',
      operation: 'deleteVolume',
      risk: 'critical',
    },
    { authority: PROD_VOLUME_TOKEN },
  ),
];

export function policyFixtureEvents(): Event[] {
  return JSON.parse(JSON.stringify(POLICY_FIXTURE_EVENTS)) as Event[];
}
