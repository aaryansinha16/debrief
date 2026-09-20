'use client';

import type { Event } from '@debrief/schema';
import type { Replay, ReplayClock } from '@debrief/ui';
import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';

import type { BlobDocument, DivergencePoint } from '../lib/api';
import { EventDetails, fetchBlob } from './event-details';

export interface NarrativeProps {
  clock: ReplayClock;
  replay: Replay;
  freezeFrame?: DivergencePoint;
  loadBlob?: (sha256: string) => Promise<BlobDocument>;
  window?: { before: number; after: number };
}

const DEFAULT_WINDOW = { before: 60, after: 20 };

// Short names for the transcript's kind column.
export const KIND_LABELS: Record<Event['kind'], string> = {
  'principal.session': 'session',
  'delegation.grant': 'grant',
  'delegation.revoke': 'revoke',
  'agent.invoke': 'invoke',
  'agent.plan': 'plan',
  'agent.message': 'message',
  'llm.call': 'model',
  'tool.call': 'tool',
  'tool.result': 'result',
  'mcp.request': 'mcp →',
  'mcp.response': 'mcp ←',
  'world.change': 'world',
  'policy.decision': 'policy',
  'human.approval': 'approval',
  error: 'error',
};

// ARCHITECTURE §11: the transcript is the reasoning track laid out in full; the current row follows the clock and the clock follows a click.
export function Narrative({
  clock,
  replay,
  freezeFrame,
  loadBlob = fetchBlob,
  window = DEFAULT_WINDOW,
}: NarrativeProps) {
  const t = useStore(clock, (state) => state.t);
  const current = replay.indexAt(t) - 1;
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[data-current="true"]');
    if (row !== null && row !== undefined && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
  }, [current]);
  const from = Math.max(0, current - window.before);
  const to = Math.min(replay.events.length, current + 1 + window.after);
  const now = current < 0 ? undefined : replay.events[current];
  const frozen = now !== undefined && freezeFrame?.eventId === now.event.id;
  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      data-testid="narrative"
      aria-label="transcript"
    >
      <h2 className="mb-2 flex items-baseline justify-between text-[11px] font-medium tracking-[0.18em] uppercase text-text-muted">
        <span>transcript</span>
        <span className="font-mono normal-case" data-testid="narrative-position">
          {String(Math.max(0, current + 1))} / {String(replay.events.length)}
        </span>
      </h2>
      <ol ref={list} className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-1" data-from={from}>
        {replay.events.slice(from, to).map((entry, offset) => {
          const index = from + offset;
          const state = index < current ? 'past' : index === current ? 'current' : 'future';
          const observed = entry.event.provenance === 'observed';
          const marked = freezeFrame?.eventId === entry.event.id;
          return (
            <li
              key={entry.event.id}
              data-testid="narrative-row"
              data-seq={entry.event.seq}
              data-state={state}
              data-current={state === 'current' ? 'true' : 'false'}
              className={`border-l-2 ${
                state === 'current'
                  ? observed
                    ? 'border-ember bg-stage-raised'
                    : 'border-cyan bg-stage-raised'
                  : marked
                    ? 'border-ember-dim'
                    : 'border-transparent'
              } ${state === 'future' ? 'opacity-40' : ''}`}
            >
              <button
                type="button"
                className="flex w-full items-baseline gap-2 py-1 pl-3 text-left text-sm"
                onClick={() => {
                  clock.getState().seek(entry.t);
                }}
              >
                <span className="w-7 shrink-0 font-mono text-xs text-text-muted">
                  {entry.event.seq}
                </span>
                <span
                  className={`w-12 shrink-0 font-mono text-xs ${observed ? 'text-ember' : 'text-cyan'}`}
                >
                  {KIND_LABELS[entry.event.kind]}
                </span>
                <span
                  className={`min-w-0 truncate ${state === 'current' ? 'text-text' : 'text-text-muted'} ${entry.event.kind === 'llm.call' ? 'italic' : ''}`}
                >
                  {entry.event.summary ?? entry.event.kind}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {now === undefined ? null : (
        <div
          className="mt-2 max-h-[45%] shrink-0 overflow-y-auto border-t border-stage-edge pt-2 text-sm"
          data-testid="narrative-now"
          data-seq={now.event.seq}
        >
          <p className={now.event.kind === 'llm.call' ? 'text-text italic' : 'text-text'}>
            {now.event.summary ?? now.event.kind}
          </p>
          {frozen ? (
            <p className="mt-1 font-mono text-xs text-ember" data-testid="narrative-freeze">
              policy {freezeFrame.effect} · {freezeFrame.ruleId ?? 'default'}
            </p>
          ) : null}
          <EventDetails key={now.event.id} event={now.event} loadBlob={loadBlob} />
        </div>
      )}
    </section>
  );
}
