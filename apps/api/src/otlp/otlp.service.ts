import { type CaptureMode, type OtelSpan, mapSpans } from '@debrief/schema';
import { Injectable } from '@nestjs/common';

import { CaptureService } from '../capture/capture.service.js';
import { CheckpointerService } from '../checkpoints/checkpointer.service.js';
import { type AppendItem, EventsRepository } from '../events/events.repository.js';
import { ulid } from '../ids/ulid.js';

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
    private readonly capture: CaptureService,
  ) {}

  stats(): IngestSummary {
    return { ...this.totals };
  }

  async ingest(
    tenantId: string,
    capture: CaptureMode,
    spans: readonly OtelSpan[],
  ): Promise<IngestSummary> {
    const mapped = mapSpans(spans, capture);
    const ts = new Date().toISOString();
    const candidates = mapped.events.map(({ sourceId, input, content }) => ({
      sourceId,
      input: { ...input, id: ulid(), ts, tenantId },
      content,
    }));
    const inputs = await this.capture.apply(tenantId, capture, candidates);
    const items: AppendItem[] = inputs.map((input, i) => ({
      input,
      sourceId: candidates[i]?.sourceId,
    }));
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
