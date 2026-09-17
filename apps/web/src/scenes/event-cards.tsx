'use client';

import type { Event } from '@debrief/schema';
import type { Replay, ReplayClock } from '@debrief/ui';
import { useState } from 'react';
import { useStore } from 'zustand';

import type { BlobDocument } from '../lib/api';

export interface EventCardsProps {
  clock: ReplayClock;
  replay: Replay;
  loadBlob?: (sha256: string) => Promise<BlobDocument>;
  limit?: number;
}

const CARD_KINDS = new Set<Event['kind']>([
  'llm.call',
  'tool.call',
  'tool.result',
  'mcp.request',
  'mcp.response',
]);
const SHOWN_ATTRS = [
  'gen_ai.request.model',
  'gen_ai.response.model',
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens',
  'gen_ai.response.finish_reasons',
  'gen_ai.tool.name',
  'gen_ai.tool.call.id',
  'gen_ai.tool.status',
  'mcp.method.name',
  'mcp.status',
  'mcp.latency_ms',
] as const;

type BlobState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; document: BlobDocument }
  | { status: 'error'; message: string };

export async function fetchBlob(sha256: string): Promise<BlobDocument> {
  const response = await fetch(`/api/blob?sha=${encodeURIComponent(sha256)}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `${String(response.status)} from /api/blob`);
  }
  return (await response.json()) as BlobDocument;
}

function EventCard({
  event,
  current,
  loadBlob,
}: {
  event: Event;
  current: boolean;
  loadBlob: (sha256: string) => Promise<BlobDocument>;
}) {
  const [open, setOpen] = useState(false);
  const [blob, setBlob] = useState<BlobState>({ status: 'idle' });
  const attrs = SHOWN_ATTRS.filter((key) => event.attrs[key] !== undefined);
  const sha = event.payloadSha256;
  const reveal = async (digest: string): Promise<void> => {
    setBlob({ status: 'loading' });
    try {
      setBlob({ status: 'loaded', document: await loadBlob(digest) });
    } catch (error) {
      setBlob({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <li
      className={`rounded border px-3 py-2 text-sm ${current ? 'border-cyan bg-stage-raised' : 'border-stage-edge'}`}
      data-testid="event-card"
      data-seq={event.seq}
      data-current={current ? 'true' : 'false'}
    >
      <button
        type="button"
        className="flex w-full items-baseline gap-2 text-left"
        onClick={() => {
          setOpen((value) => !value);
        }}
        aria-expanded={open}
      >
        <span className="font-mono text-xs text-text-muted">#{event.seq}</span>
        <span className="font-mono text-xs text-cyan">{event.kind}</span>
        <span className="truncate">{event.summary ?? ''}</span>
      </button>
      {open ? (
        <div className="mt-2 flex flex-col gap-2" data-testid="card-details">
          {attrs.length === 0 ? null : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs text-text-muted">
              {attrs.map((key) => (
                <div key={key} className="contents">
                  <dt>{key}</dt>
                  <dd className="text-text">{String(event.attrs[key])}</dd>
                </div>
              ))}
            </dl>
          )}
          {sha === undefined ? (
            <p className="text-xs text-text-muted">
              no captured content (capture mode off or summary)
            </p>
          ) : blob.status === 'loaded' ? (
            <div className="flex flex-col gap-2" data-testid="blob-content">
              {Object.entries(blob.document.content).map(([key, value]) => (
                <div key={key}>
                  <p className="font-mono text-xs text-text-muted">{key}</p>
                  <pre className="max-h-64 overflow-auto rounded bg-stage p-2 text-xs whitespace-pre-wrap">
                    {value}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <button
              type="button"
              className="self-start rounded border border-stage-edge px-2 py-1 font-mono text-xs hover:bg-stage"
              onClick={() => {
                void reveal(sha);
              }}
              disabled={blob.status === 'loading'}
              data-testid="reveal-blob"
            >
              {blob.status === 'loading'
                ? 'loading…'
                : blob.status === 'error'
                  ? `retry · ${blob.message}`
                  : 'show captured content'}
            </button>
          )}
        </div>
      ) : null}
    </li>
  );
}

// Cards for the reasoning and tool events up to the clock, newest first; content is fetched only when a card asks for it.
export function EventCards({ clock, replay, loadBlob = fetchBlob, limit = 40 }: EventCardsProps) {
  const t = useStore(clock, (state) => state.t);
  const applied = replay.indexAt(t);
  const cards: { event: Event; current: boolean }[] = [];
  for (let index = applied - 1; index >= 0 && cards.length < limit; index -= 1) {
    const entry = replay.events[index];
    if (entry !== undefined && CARD_KINDS.has(entry.event.kind)) {
      cards.push({ event: entry.event, current: index === applied - 1 });
    }
  }
  return (
    <section className="flex h-full min-h-0 flex-col" data-testid="event-cards">
      <h2 className="mb-2 text-xs tracking-wider text-text-muted uppercase">
        Reasoning &amp; tools
      </h2>
      {cards.length === 0 ? (
        <p className="text-sm text-text-muted">no reasoning yet</p>
      ) : (
        <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
          {cards.map(({ event, current }) => (
            <EventCard key={event.id} event={event} current={current} loadBlob={loadBlob} />
          ))}
        </ul>
      )}
    </section>
  );
}
