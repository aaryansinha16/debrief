import type { AttrValue, Event, EventKind } from '@debrief/schema';

export interface ResourceState {
  system: string;
  resource: string;
  environment?: string;
  fields: Record<string, AttrValue>;
  lastOperation?: string;
  lastEventId: string;
  mutations: number;
}

export interface TokenState {
  tokenRef: string;
  principalId: string;
  holder?: string;
  label?: string;
  scope: string[];
  permissions: string[];
  grantedBy: string;
  revoked: boolean;
}

export interface WorldState {
  applied: number;
  lastEventId?: string;
  resources: Record<string, ResourceState>;
  tokens: Record<string, TokenState>;
  counts: Partial<Record<EventKind, number>>;
}

export const EMPTY_WORLD: WorldState = { applied: 0, resources: {}, tokens: {}, counts: {} };

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

// Copy-on-write: touched entries are replaced, never mutated, so snapshots stay valid after being extended.
export function applyEvent(state: WorldState, event: Event): WorldState {
  const counts = { ...state.counts, [event.kind]: (state.counts[event.kind] ?? 0) + 1 };
  const next: WorldState = { ...state, applied: state.applied + 1, lastEventId: event.id, counts };
  if (event.kind === 'world.change' && event.target?.resource !== undefined) {
    const key = `${event.target.system}:${event.target.resource}`;
    const previous = state.resources[key];
    const fields = { ...previous?.fields };
    const field = asString(event.attrs['world.field']);
    const after = event.attrs['world.after'];
    if (field !== undefined && after !== undefined) fields[field] = after;
    const resource: ResourceState = {
      system: event.target.system,
      resource: event.target.resource,
      fields,
      lastEventId: event.id,
      mutations: (previous?.mutations ?? 0) + 1,
    };
    const environment = event.target.environment ?? previous?.environment;
    if (environment !== undefined) resource.environment = environment;
    const operation = event.target.operation ?? previous?.lastOperation;
    if (operation !== undefined) resource.lastOperation = operation;
    next.resources = { ...state.resources, [key]: resource };
    return next;
  }
  if (event.kind === 'delegation.grant' || event.kind === 'delegation.revoke') {
    const authority = event.authority;
    const ref = authority?.tokenRef ?? authority?.grantId;
    if (authority === undefined || ref === undefined) return next;
    const previous = state.tokens[ref];
    const token: TokenState = {
      tokenRef: ref,
      principalId: authority.principalId,
      scope: [...(authority.scope ?? previous?.scope ?? [])],
      permissions: [...(authority.permissions ?? previous?.permissions ?? [])],
      grantedBy: previous?.grantedBy ?? event.actor.id,
      revoked: event.kind === 'delegation.revoke',
    };
    const holder = asString(event.attrs['delegation.to']) ?? previous?.holder;
    if (holder !== undefined) token.holder = holder;
    const label = asString(event.attrs['delegation.token.label']) ?? previous?.label;
    if (label !== undefined) token.label = label;
    next.tokens = { ...state.tokens, [ref]: token };
  }
  return next;
}
