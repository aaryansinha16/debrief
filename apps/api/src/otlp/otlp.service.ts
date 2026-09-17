import { type CaptureMode, type EventInput, type OtelSpan, mapSpans } from '@debrief/schema';
import { Injectable } from '@nestjs/common';

import { BlobsService } from '../blobs/blobs.service.js';
import { CheckpointerService } from '../checkpoints/checkpointer.service.js';
import { type AppendItem, EventsRepository } from '../events/events.repository.js';
import { ulid } from '../ids/ulid.js';
import { TenantKeysService } from '../tenants/tenant-keys.service.js';
import { deriveSnippet, redactedContentDocument, summaryWithSnippet } from './content.js';

export interface IngestSummary {
  spans: number;
  accepted: number;
  duplicates: number;
  ignored: number;
}

@Injectable()
export class OtlpService {
  private readonly totals: IngestSummary = { spans: 0, accepted: 0, duplicates: 0, ignored: 0 };

  constructor(
    private readonly events: EventsRepository,
    private readonly checkpointer: CheckpointerService,
    private readonly blobs: BlobsService,
    private readonly tenantKeys: TenantKeysService,
  ) {}

  stats(): IngestSummary {
    return { ...this.totals };
  }

  // Capture `summary` quotes a redacted snippet; `on` also seals the redacted content into a blob.
  async ingest(
    tenantId: string,
    capture: CaptureMode,
    spans: readonly OtelSpan[],
  ): Promise<IngestSummary> {
    const mapped = mapSpans(spans, capture);
    const ts = new Date().toISOString();
    const salt = mapped.events.some((event) => event.content !== undefined)
      ? await this.tenantKeys.saltFor(tenantId)
      : '';
    const items: AppendItem[] = [];
    for (const spanEvent of mapped.events) {
      const { sourceId, input, content } = spanEvent;
      const event: EventInput = { ...input, id: ulid(), ts, tenantId };
      if (content !== undefined) {
        const snippet = deriveSnippet(content, salt);
        const summary = summaryWithSnippet(input.summary, snippet);
        if (summary !== undefined) event.summary = summary;
        if (capture === 'on') {
          const document = redactedContentDocument(spanEvent, salt);
          if (document !== undefined) {
            const blob = await this.blobs.put(tenantId, document, 'application/json');
            event.payloadSha256 = blob.sha256;
          }
        }
      }
      items.push({ input: event, sourceId });
    }
    const result = await this.events.append(tenantId, items);
    const last = result.events[result.events.length - 1];
    if (last !== undefined) this.checkpointer.observe(tenantId, last.seq);
    const summary: IngestSummary = {
      spans: spans.length,
      accepted: result.events.length,
      duplicates: result.duplicates,
      ignored: mapped.dropped['unknown-operation'],
    };
    for (const key of Object.keys(summary) as (keyof IngestSummary)[])
      this.totals[key] += summary[key];
    return summary;
  }
}
