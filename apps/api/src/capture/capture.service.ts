import { type CaptureMode, type EventInput, redactContent } from '@debrief/schema';
import { Injectable } from '@nestjs/common';

import { BlobsService } from '../blobs/blobs.service.js';
import { deriveSnippet, summaryWithSnippet } from '../otlp/content.js';
import { TenantKeysService } from '../tenants/tenant-keys.service.js';

export interface CaptureCandidate {
  sourceId?: string;
  input: EventInput;
  content?: Record<string, string>;
}

// Capture `summary` quotes a redacted snippet; `on` also seals the redacted content into a blob (D-029).
@Injectable()
export class CaptureService {
  constructor(
    private readonly blobs: BlobsService,
    private readonly tenantKeys: TenantKeysService,
  ) {}

  async apply(
    tenantId: string,
    capture: CaptureMode,
    candidates: readonly CaptureCandidate[],
  ): Promise<EventInput[]> {
    const withContent = candidates.filter((candidate) => candidate.content !== undefined);
    if (capture === 'off' || withContent.length === 0)
      return candidates.map((candidate) => candidate.input);
    const salt = await this.tenantKeys.saltFor(tenantId);
    const out: EventInput[] = [];
    for (const { sourceId, input, content } of candidates) {
      const event: EventInput = { ...input };
      if (content !== undefined) {
        const summary = summaryWithSnippet(input.summary, deriveSnippet(content, salt));
        if (summary !== undefined) event.summary = summary;
        if (capture === 'on') {
          const document = new TextEncoder().encode(
            JSON.stringify({
              sourceId: sourceId ?? input.id,
              content: redactContent(content, { salt }),
            }),
          );
          const blob = await this.blobs.put(tenantId, document, 'application/json');
          event.payloadSha256 = blob.sha256;
        }
      }
      out.push(event);
    }
    return out;
  }
}
