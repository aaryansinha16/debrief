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

export const cloneWorld = (state: WorldState): WorldState => ({
  ...state,
  resources: { ...state.resources },
  tokens: { ...state.tokens },
  counts: { ...state.counts },
});

// Mutates only the draft's own records; resource and token objects are replaced, never edited, so shared snapshots stay intact.
export function applyInto(draft: WorldState, event: Event): void {
  draft.applied += 1;
  draft.lastEventId = event.id;
  draft.counts[event.kind] = (draft.counts[event.kind] ?? 0) + 1;
  if (event.kind === 'world.change' && event.target?.resource !== undefined) {
    const key = `${event.target.system}:${event.target.resource}`;
    const previous = draft.resources[key];
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
    draft.resources[key] = resource;
    return;
  }
  if (event.kind === 'delegation.grant' || event.kind === 'delegation.revoke') {
    const authority = event.authority;
    const ref = authority?.tokenRef ?? authority?.grantId;
    if (authority === undefined || ref === undefined) return;
    const previous = draft.tokens[ref];
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
    draft.tokens[ref] = token;
  }
}

export function applyEvent(state: WorldState, event: Event): WorldState {
  const draft = cloneWorld(state);
  applyInto(draft, event);
  return draft;
}
