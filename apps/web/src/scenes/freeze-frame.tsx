'use client';

import type { Event } from '@debrief/schema';
import type { Replay, ReplayClock } from '@debrief/ui';
import { useStore } from 'zustand';

import { Button, Kbd, PlayIcon } from '../components/controls';

import type { DivergencePoint } from '../lib/api';
import { ruleBlock } from '../lib/policy-text';

export interface FreezeFrameProps {
  clock: ReplayClock;
  replay: Replay;
  freezeFrame?: DivergencePoint;
  policyId: string;
  policyYaml?: string;
  consequences?: readonly Event[];
}

function ActionSide({ event }: { event: Event }) {
  const target = event.target;
  const authority = event.authority;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="freeze-action">
      <h3 className="text-[11px] font-medium tracking-[0.18em] uppercase text-text-muted">
        the action
      </h3>
      <p className="font-mono text-sm text-text-muted">
        #{event.seq} {event.kind} ·{' '}
        <span className={event.provenance === 'observed' ? 'text-ember' : 'text-cyan'}>
          {event.provenance}
        </span>
      </p>
      <p className="text-sm text-text">{event.summary ?? '(no summary)'}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 font-mono text-sm">
        <dt className="text-text-muted">actor</dt>
        <dd className="break-all">{event.actor.name ?? event.actor.id}</dd>
        {target === undefined ? null : (
          <>
            <dt className="text-text-muted">system</dt>
            <dd>{target.system}</dd>
            {target.resource === undefined ? null : (
              <>
                <dt className="text-text-muted">resource</dt>
                <dd className="break-all">{target.resource}</dd>
              </>
            )}
            {target.environment === undefined ? null : (
              <>
                <dt className="text-text-muted">environment</dt>
                <dd className={target.environment === 'production' ? 'text-ember' : ''}>
                  {target.environment}
                </dd>
              </>
            )}
            {target.operation === undefined ? null : (
              <>
                <dt className="text-text-muted">operation</dt>
                <dd>{target.operation}</dd>
              </>
            )}
            {target.risk === undefined ? null : (
              <>
                <dt className="text-text-muted">risk</dt>
                <dd
                  className={
                    target.risk === 'critical' || target.risk === 'high' ? 'text-ember' : ''
                  }
                >
                  {target.risk}
                </dd>
              </>
            )}
          </>
        )}
        {authority === undefined ? null : (
          <>
            <dt className="text-text-muted">token</dt>
            <dd className="break-all">
              {authority.tokenRef ?? authority.grantId ?? authority.principalId}
            </dd>
            <dt className="text-text-muted">scope</dt>
            <dd className="text-cyan">{authority.scope?.join(', ') ?? '—'}</dd>
            <dt className="text-text-muted">permissions</dt>
            <dd className="text-ember">{authority.permissions?.join(', ') ?? '—'}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function Consequence({ event }: { event: Event }) {
  const target = event.target;
  const facts = Object.entries(event.attrs).filter(
    ([key]) =>
      key.startsWith('world.') &&
      ![
        'world.field',
        'world.before',
        'world.after',
        'world.resource',
        'world.project',
        'world.environment',
        'world.operation',
      ].includes(key),
  );
  return (
    <div
      className="rounded border border-ember-dim bg-stage-raised p-3"
      data-testid="freeze-consequence"
    >
      <p className="mb-1 font-mono text-sm text-ember">● observed consequence · #{event.seq}</p>
      <p className="text-sm text-text">{event.summary ?? ''}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 font-mono text-sm">
        {target?.resource === undefined ? null : (
          <>
            <dt className="text-text-muted">resource</dt>
            <dd className="break-all">{target.resource}</dd>
          </>
        )}
        {target?.environment === undefined ? null : (
          <>
            <dt className="text-text-muted">environment</dt>
            <dd className={target.environment === 'production' ? 'text-ember' : ''}>
              {target.environment}
            </dd>
          </>
        )}
        {target?.risk === undefined ? null : (
          <>
            <dt className="text-text-muted">risk</dt>
            <dd
              className={target.risk === 'critical' || target.risk === 'high' ? 'text-ember' : ''}
            >
              {target.risk}
            </dd>
          </>
        )}
        {typeof event.attrs['world.field'] === 'string' ? (
          <>
            <dt className="text-text-muted">{event.attrs['world.field']}</dt>
            <dd>
              {String(event.attrs['world.before'] ?? '?')} →{' '}
              {String(event.attrs['world.after'] ?? '?')}
            </dd>
          </>
        ) : null}
        {facts.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-text-muted">{key.slice('world.'.length)}</dt>
            <dd>
              {typeof value === 'number' && value > 9999
                ? value.toLocaleString('en-US')
                : String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ARCHITECTURE §11: at the first divergence time freezes and the split shows the policy against the action; continue resumes.
export function FreezeFrame({
  clock,
  replay,
  freezeFrame,
  policyId,
  policyYaml,
  consequences = [],
}: FreezeFrameProps) {
  const frozenAt = useStore(clock, (state) => state.frozenAt);
  if (frozenAt === undefined || freezeFrame === undefined) return null;
  const entry = replay.events.find((candidate) => candidate.event.id === freezeFrame.eventId);
  if (entry === undefined) return null;
  const block =
    policyYaml === undefined || freezeFrame.ruleId === undefined
      ? undefined
      : ruleBlock(policyYaml, freezeFrame.ruleId);
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col rounded border border-ember-dim bg-stage/95 p-4"
      data-testid="freeze-frame"
      data-seq={freezeFrame.seq}
      role="dialog"
      aria-label="freeze frame"
    >
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-base font-semibold">
          <span className="text-ember">freeze frame</span> · policy {policyId} says{' '}
          <span className="font-mono">{freezeFrame.effect}</span>
        </h2>
        <span className="font-mono text-sm text-text-muted">
          t = {(frozenAt / 1000).toFixed(2)} s · seq {freezeFrame.seq}
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-6">
        <div
          className="flex min-h-0 min-w-0 flex-col gap-2 overflow-auto"
          data-testid="freeze-policy"
        >
          <h3 className="text-[11px] font-medium tracking-[0.18em] uppercase text-text-muted">
            the policy
          </h3>
          <p className="text-sm text-text-muted">{freezeFrame.explanation}</p>
          <pre className="rounded border border-ember-dim bg-stage-raised p-3 font-mono text-sm leading-5 whitespace-pre-wrap text-text">
            {block ?? freezeFrame.ruleId ?? `default ${freezeFrame.effect}`}
          </pre>
        </div>
        <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-auto">
          <ActionSide event={entry.event} />
          {consequences.map((event) => (
            <Consequence key={event.id} event={event} />
          ))}
        </div>
      </div>
      <div className="mt-3 flex shrink-0 items-center gap-3">
        <Button
          variant="primary"
          icon={<PlayIcon />}
          onClick={() => {
            clock.getState().play();
          }}
          data-testid="continue"
        >
          continue
        </Button>
        <Button
          onClick={() => {
            clock.getState().seek(frozenAt);
          }}
          data-testid="stay"
        >
          stay here
        </Button>
        <span className="text-sm text-text-muted">
          <Kbd>space</Kbd> also continues
        </span>
      </div>
    </div>
  );
}
