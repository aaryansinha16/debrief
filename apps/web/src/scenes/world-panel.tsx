'use client';

import type { AttrValue } from '@debrief/schema';
import type { FieldChange, Replay, ReplayClock, ResourceState, TokenState } from '@debrief/ui';
import { useStore } from 'zustand';

export interface WorldPanelProps {
  clock: ReplayClock;
  replay: Replay;
}

// `projects/<p>/volumes/<id>` → class `volumes`, name `<id>`; a bare name has no class.
export const resourceClass = (resource: string): string => {
  const parts = resource.split('/');
  return parts.at(-2) ?? 'other';
};

export const resourceName = (resource: string): string =>
  resource.slice(resource.lastIndexOf('/') + 1);

const show = (value: AttrValue | undefined): string =>
  value === undefined
    ? '—'
    : typeof value === 'number' && value > 9999
      ? value.toLocaleString('en-US')
      : String(value);

// A value that changed at the current event remounts (keyed by the change) and plays the ember flash.
function Value({
  value,
  change,
  currentEventId,
  testId,
}: {
  value: AttrValue | undefined;
  change?: FieldChange;
  currentEventId?: string;
  testId: string;
}) {
  const fresh = change !== undefined && change.eventId === currentEventId;
  return (
    <span
      key={change?.eventId ?? 'initial'}
      className={`font-mono ${fresh ? 'animate-flash text-ember' : 'text-text'}`}
      data-testid={testId}
      data-changed={fresh ? change.eventId : undefined}
    >
      {fresh && change.before !== undefined ? (
        <span className="mr-1 text-text-muted line-through">{show(change.before)}</span>
      ) : null}
      {show(value)}
    </span>
  );
}

// Backups: the observed deletion reports how many went with the volume; before that we only know whether any existed.
export function backupsOf(resource: ResourceState): {
  value: AttrValue | undefined;
  change?: FieldChange;
} {
  const exists = resource.fields.backupExists;
  const deleted = resource.fields.backupsDeleted;
  const change = resource.changes.backupExists;
  if (exists === false) {
    const before = typeof deleted === 'number' ? deleted : change?.before === true ? 1 : undefined;
    const result: { value: AttrValue | undefined; change?: FieldChange } = { value: 0 };
    if (change !== undefined) result.change = before === undefined ? change : { ...change, before };
    return result;
  }
  if (exists === true) return { value: 'yes', ...(change === undefined ? {} : { change }) };
  return { value: undefined };
}

function VolumeRow({
  resource,
  currentEventId,
}: {
  resource: ResourceState;
  currentEventId?: string;
}) {
  const backups = backupsOf(resource);
  return (
    <tr data-testid="volume-row" data-resource={resource.resource}>
      <td className="py-1 pr-3 font-mono text-cyan">{resourceName(resource.resource)}</td>
      <td className="py-1 pr-3 text-text-muted">{resource.environment ?? '—'}</td>
      <td className="py-1 pr-3">
        <Value
          value={backups.value}
          change={backups.change}
          currentEventId={currentEventId}
          testId="backups"
        />
      </td>
      <td className="py-1 pr-3">
        <Value
          value={resource.fields.rowsOrBytes}
          change={resource.changes.rowsOrBytes}
          currentEventId={currentEventId}
          testId="bytes"
        />
      </td>
      <td className="py-1 font-mono text-xs text-text-muted">{resource.lastOperation ?? ''}</td>
    </tr>
  );
}

function GenericRow({
  resource,
  currentEventId,
}: {
  resource: ResourceState;
  currentEventId?: string;
}) {
  const fields = Object.keys(resource.fields).filter((name) => name !== 'backupsDeleted');
  return (
    <tr data-testid="resource-row" data-resource={resource.resource}>
      <td className="py-1 pr-3 font-mono text-cyan">{resourceName(resource.resource)}</td>
      <td className="py-1 pr-3 text-text-muted">{resource.environment ?? '—'}</td>
      <td className="py-1 pr-3">
        {fields.length === 0 ? (
          <span className="text-text-muted">—</span>
        ) : (
          fields.map((name) => (
            <span key={name} className="mr-3 text-xs">
              <span className="text-text-muted">{name} </span>
              <Value
                value={resource.fields[name]}
                change={resource.changes[name]}
                currentEventId={currentEventId}
                testId={`field-${name}`}
              />
            </span>
          ))
        )}
      </td>
      <td className="py-1 font-mono text-xs text-text-muted">{resource.lastOperation ?? ''}</td>
    </tr>
  );
}

function TokenRow({ token }: { token: TokenState }) {
  return (
    <li className="font-mono text-xs" data-testid="token-row" data-token={token.tokenRef}>
      <span className={token.revoked ? 'text-text-muted line-through' : 'text-cyan'}>
        {token.label ?? token.tokenRef}
      </span>
      <span className="text-text-muted"> → {token.holder ?? '—'}</span>
      <div className="text-text-muted">
        scope <span className="text-text">{token.scope.join(', ') || '—'}</span> · perms{' '}
        <span
          className={token.permissions.some((p) => p.includes('*')) ? 'text-ember' : 'text-text'}
        >
          {token.permissions.join(', ') || '—'}
        </span>
      </div>
    </li>
  );
}

const SECTIONS = ['volumes', 'files', 'credentials'] as const;

// ARCHITECTURE §11: the world-state side panel is the reducer at the clock, nothing else; every value comes from an event.
export function WorldPanel({ clock, replay }: WorldPanelProps) {
  const t = useStore(clock, (state) => state.t);
  const world = replay.stateAt(t);
  const currentEventId = world.lastEventId;
  const resources = Object.values(world.resources);
  const grouped = new Map<string, ResourceState[]>();
  for (const resource of resources) {
    const cls = resourceClass(resource.resource);
    grouped.set(cls, [...(grouped.get(cls) ?? []), resource]);
  }
  const others = [...grouped.keys()].filter(
    (cls) => !SECTIONS.includes(cls as (typeof SECTIONS)[number]),
  );
  const tokens = Object.values(world.tokens);
  return (
    <section
      className="flex flex-col gap-4 text-sm"
      data-testid="world-panel"
      data-event={currentEventId ?? ''}
    >
      {[...SECTIONS, ...others].map((cls) => {
        const rows = grouped.get(cls) ?? [];
        return (
          <div key={cls} data-testid={`section-${cls}`}>
            <h2 className="mb-1 text-xs tracking-wider text-text-muted uppercase">{cls}</h2>
            {rows.length === 0 ? (
              <p className="text-xs text-text-muted">nothing observed</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="text-text-muted">
                  <tr>
                    <th className="pr-3 font-normal">name</th>
                    <th className="pr-3 font-normal">env</th>
                    {cls === 'volumes' ? (
                      <>
                        <th className="pr-3 font-normal">backups</th>
                        <th className="pr-3 font-normal">bytes</th>
                      </>
                    ) : (
                      <th className="pr-3 font-normal">state</th>
                    )}
                    <th className="font-normal">last op</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((resource) =>
                    cls === 'volumes' ? (
                      <VolumeRow
                        key={resource.resource}
                        resource={resource}
                        currentEventId={currentEventId}
                      />
                    ) : (
                      <GenericRow
                        key={resource.resource}
                        resource={resource}
                        currentEventId={currentEventId}
                      />
                    ),
                  )}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
      <div data-testid="section-tokens">
        <h2 className="mb-1 text-xs tracking-wider text-text-muted uppercase">tokens</h2>
        {tokens.length === 0 ? (
          <p className="text-xs text-text-muted">no grants yet</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {tokens.map((token) => (
              <TokenRow key={token.tokenRef} token={token} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
