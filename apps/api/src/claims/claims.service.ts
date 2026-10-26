import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import {
  type Claim,
  type DropReason,
  type Reply,
  type TranscriptMessage,
  SYSTEM_PROMPT,
  claimEvent,
  claimSpan,
  extractClaims,
  overlapsAny,
  replySchema,
  userPrompt,
} from '@debrief/claims';
import { type Event, eventInputSchema } from '@debrief/schema';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  BadGatewayException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';
import { z } from 'zod';

import { BlobsService } from '../blobs/blobs.service.js';
import { CheckpointerService } from '../checkpoints/checkpointer.service.js';
import { CONFIG, type Config } from '../config/config.js';
import { DB, type Db } from '../db/db.module.js';
import { claimExtractions } from '../db/schema.js';
import { EventsRepository } from '../events/events.repository.js';
import { ulid } from '../ids/ulid.js';
import { RunsService } from '../runs/runs.service.js';

export interface ClaimsResponse {
  runId: string;
  transcriptHash: string;
  model: string | null;
  cached: boolean;
  messages: number;
  claims: (Claim & { appended: boolean })[];
  dropped: Record<DropReason, number>;
}

export interface Extractor {
  extract(messages: readonly TranscriptMessage[]): Promise<{ reply: Reply; model: string }>;
}

const PAGE = 1000;
const SAID = 'gen_ai.output.messages';
const documentSchema = z.looseObject({ content: z.record(z.string(), z.string()) });
// Models with a server-side refusal fallback; any other configured model runs without one.
const FALLBACK_MODELS = new Set([
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-fable-5-1',
  'claude-sonnet-5-5',
]);

const noneDropped = (): Record<DropReason, number> => ({
  'unknown-message': 0,
  'empty-quote': 0,
  'quote-too-long': 0,
  'quote-not-found': 0,
  repeated: 0,
});

// D-077: one model call per transcript, cached by its hash, off the ingest and verdict paths.
@Injectable()
export class ClaimsService {
  private extractor: Extractor | undefined;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: Db,
    private readonly events: EventsRepository,
    private readonly blobs: BlobsService,
    private readonly checkpointer: CheckpointerService,
    private readonly runs: RunsService,
    private readonly logger: Logger,
  ) {}

  private extractorFor(): Extractor {
    if (this.extractor !== undefined) return this.extractor;
    const apiKey = this.config.ANTHROPIC_API_KEY;
    if (apiKey === undefined) {
      throw new ServiceUnavailableException(
        'claim extraction is not configured: set ANTHROPIC_API_KEY',
      );
    }
    const client = new Anthropic({ apiKey });
    const model = this.config.CLAIMS_MODEL;
    const fallback = FALLBACK_MODELS.has(model)
      ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
      : {};
    this.extractor = {
      extract: async (messages) => {
        const response = await client.beta.messages
          .parse({
            model,
            max_tokens: 16000,
            ...fallback,
            output_config: { effort: 'medium', format: betaZodOutputFormat(replySchema) },
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt(messages) }],
          })
          .catch((error: unknown) => {
            const why =
              error instanceof Anthropic.APIError
                ? `the model API answered ${String(error.status)}`
                : 'the reply was not the claims shape';
            throw new BadGatewayException(`claim extraction failed: ${why}`);
          });
        if (response.parsed_output === null) {
          throw new BadGatewayException(
            `claim extraction returned no claims (${response.stop_reason ?? 'no stop reason'})`,
          );
        }
        return { reply: response.parsed_output, model: response.model };
      },
    };
    return this.extractor;
  }

  async extract(tenantId: string, runId: string): Promise<ClaimsResponse> {
    const messages = await this.messagesOf(tenantId, await this.runEvents(tenantId, runId));
    const chars = messages.reduce((total, message) => total + message.text.length, 0);
    if (chars > this.config.CLAIMS_MAX_CHARS) {
      throw new PayloadTooLargeException(
        `the session's messages hold ${String(chars)} characters, more than one extraction reads (CLAIMS_MAX_CHARS)`,
      );
    }
    const transcriptHash = bytesToHex(
      sha256(utf8ToBytes(JSON.stringify(messages.map(({ id, text }) => [id, text])))),
    );
    const base = { runId, transcriptHash, messages: messages.length };
    if (messages.length === 0) {
      return { ...base, model: null, cached: false, claims: [], dropped: noneDropped() };
    }
    const [hit] = await this.db
      .select()
      .from(claimExtractions)
      .where(
        and(
          eq(claimExtractions.tenantId, tenantId),
          eq(claimExtractions.runId, runId),
          eq(claimExtractions.transcriptHash, transcriptHash),
        ),
      )
      .limit(1);
    let answer: { reply: Reply; model: string };
    if (hit === undefined) {
      answer = await this.extractorFor().extract(messages);
      await this.db
        .insert(claimExtractions)
        .values({ tenantId, runId, transcriptHash, model: answer.model, reply: answer.reply })
        .onConflictDoNothing();
    } else answer = { reply: replySchema.parse(hit.reply), model: hit.model };
    const extraction = extractClaims(answer.reply, messages);
    const appended = await this.appendNew(tenantId, runId, extraction.claims);
    this.logger.log(
      {
        tenantId,
        runId,
        claims: extraction.claims.length,
        appended: appended.size,
        dropped: extraction.dropped,
      },
      'claims extracted',
    );
    return {
      ...base,
      model: answer.model,
      cached: hit !== undefined,
      claims: extraction.claims.map((claim) => ({ ...claim, appended: appended.has(claim) })),
      dropped: extraction.dropped,
    };
  }

  private async runEvents(tenantId: string, runId: string): Promise<Event[]> {
    const all: Event[] = [];
    for (let from = 0; ;) {
      const page = await this.events.listByRun(tenantId, runId, from, undefined, PAGE);
      all.push(...page);
      const last = page[page.length - 1];
      if (page.length < PAGE || last === undefined) break;
      from = last.seq + 1;
    }
    if (all.length === 0) throw new NotFoundException('run not found');
    return all;
  }

  // The agent's own words only: its messages' sealed, already-redacted content (§18.2, capture `on`).
  private async messagesOf(
    tenantId: string,
    events: readonly Event[],
  ): Promise<TranscriptMessage[]> {
    const messages: TranscriptMessage[] = [];
    for (const event of events) {
      const agent = event.actor.type === 'agent' || event.actor.type === 'subagent';
      if (event.kind !== 'agent.message' || !agent || event.payloadSha256 === undefined) continue;
      const sealed = await this.blobs.get(tenantId, event.payloadSha256);
      const parsed = documentSchema.safeParse(
        sealed === undefined ? undefined : JSON.parse(new TextDecoder().decode(sealed.body)),
      );
      const text = parsed.success ? parsed.data.content[SAID] : undefined;
      if (text !== undefined && text !== '') {
        messages.push({ id: event.id, text, saidAt: event.sourceTs });
      }
    }
    return messages;
  }

  // Claims carry no sourceId: a claim overlapping one already stored for its message is the duplicate (§18.2).
  private async appendNew(
    tenantId: string,
    runId: string,
    claims: readonly Claim[],
  ): Promise<Set<Claim>> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`claims\t${tenantId}\t${runId}`}, 0))`,
      );
      const stored = (await this.runEvents(tenantId, runId)).flatMap((event) => {
        const span = event.kind === 'claim' ? claimSpan(event.attrs) : undefined;
        return span === undefined ? [] : [span];
      });
      const fresh = claims.filter((claim) => !overlapsAny(claim.span, stored));
      if (fresh.length === 0) return new Set<Claim>();
      const ts = new Date().toISOString();
      const items = fresh.map((claim) => ({
        input: eventInputSchema.parse({ ...claimEvent(claim, runId), id: ulid(), ts, tenantId }),
      }));
      const result = await this.events.append(tenantId, items, 'third-party');
      const last = result.events[result.events.length - 1];
      if (last !== undefined) this.checkpointer.observe(tenantId, last.seq);
      this.runs.observe(tenantId, result.events);
      return new Set(fresh);
    });
  }
}
