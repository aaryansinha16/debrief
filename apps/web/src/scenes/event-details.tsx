'use client';

import type { Event } from '@debrief/schema';
import { useState } from 'react';

import { Button } from '../components/controls';
import type { BlobDocument } from '../lib/api';

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

// Attributes worth a glance plus the sealed content, fetched only when asked for; shared by the cards and the narrative.
export function EventDetails({
  event,
  loadBlob,
}: {
  event: Event;
  loadBlob: (sha256: string) => Promise<BlobDocument>;
}) {
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
        <p className="text-xs text-text-muted">no captured content (capture mode off or summary)</p>
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
        <Button
          className="self-start"
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
        </Button>
      )}
    </div>
  );
}
