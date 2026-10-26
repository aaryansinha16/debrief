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
import { and, eq } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';
import { z } from 'zod';

import { BlobsService } from '../blobs/blobs.service.js';
import { CheckpointerService } from '../checkpoints/checkpointer.service.js';
import { CONFIG, type Config } from '../config/config.js';
import { DB, type Db } from '../db/db.module.js';
import { claimExtractions, events as eventsTable } from '../db/schema.js';
import {
  type AppendItem,
  type AppendPrepare,
  EventsRepository,
} from '../events/events.repository.js';
import { ulid } from '../ids/ulid.js';
import { RunsService } from '../runs/runs.service.js';

export interface ClaimsResponse {
  runId: string;
  transcriptHash: string;
  model: string | null;
  cached: boolean;
  messages: number;
  truncated: number;
  claims: (Claim & { appended: boolean })[];
  dropped: Record<DropReason | 'changed-by-redaction' | 'invalid', number>;
}

export interface Extractor {
  extract(messages: readonly TranscriptMessage[]): Promise<{ reply: Reply; model: string }>;
}

const PAGE = 1000;
const SAID = 'gen_ai.output.messages';
// Capture keeps 4096 characters of a message and marks the cut; the marker is Debrief's, never the agent's words.
const TRUNCATED = /…\[\+\d+ chars\]$/;
const documentSchema = z.looseObject({ content: z.record(z.string(), z.string()) });

const noneDropped = (): ClaimsResponse['dropped'] => ({
  'unknown-message': 0,
  'empty-quote': 0,
  'quote-too-long': 0,
  'quote-not-found': 0,
  repeated: 0,
  'changed-by-redaction': 0,
  invalid: 0,
});

interface Answer {
  reply: Reply;
  model: string;
}

// D-077: one model call per transcript, cached by its hash, off the ingest and verdict paths.
@Injectable()
export class ClaimsService {
  private extractor: Extractor | undefined;
  private readonly inflight = new Map<string, Promise<Answer>>();

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
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 300_000 });
    const model = this.config.CLAIMS_MODEL;
    const fallback = this.config.CLAIMS_FALLBACK
      ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
      : {};
    this.extractor = {
      extract: async (messages) => {
        const response = await client.beta.messages
          .parse({
            model,
            max_tokens: 16000,
            ...fallback,
            thinking: { type: 'adaptive' },
            output_config: { effort: 'medium', format: betaZodOutputFormat(replySchema) },
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt(messages) }],
          })
          .catch((error: unknown) => {
            const why = !(error instanceof Anthropic.APIError)
              ? 'the reply was not the claims shape'
              : error.status === undefined
                ? 'the model API did not answer'
                : `the model API answered ${String(error.status)}`;
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
    const { messages, truncated } = await this.messagesOf(
      tenantId,
      await this.runEvents(tenantId, runId),
    );
    const chars = messages.reduce((total, message) => total + message.text.length, 0);
    if (chars > this.config.CLAIMS_MAX_CHARS) {
      throw new PayloadTooLargeException(
        `the session's messages hold ${String(chars)} characters, more than one extraction reads (CLAIMS_MAX_CHARS)`,
      );
    }
    // The key covers the model and the prompt too, so changing either extracts afresh.
    const key = [
      this.config.CLAIMS_MODEL,
      SYSTEM_PROMPT,
      messages.map(({ id, text }) => [id, text]),
    ];
    const transcriptHash = bytesToHex(sha256(utf8ToBytes(JSON.stringify(key))));
    const base = { runId, transcriptHash, messages: messages.length, truncated };
    if (messages.length === 0) {
      return { ...base, model: null, cached: false, claims: [], dropped: noneDropped() };
    }
    const { answer, cached } = await this.answerFor(tenantId, runId, transcriptHash, messages);
    const extraction = extractClaims(answer.reply, messages);
    const stored = await this.appendNew(tenantId, runId, extraction.claims);
    const dropped = { ...noneDropped(), ...extraction.dropped, ...stored.dropped };
    this.logger.log(
      {
        tenantId,
        runId,
        claims: extraction.claims.length,
        appended: stored.appended.size,
        dropped,
      },
      'claims extracted',
    );
    return {
      ...base,
      model: answer.model,
      cached,
      claims: extraction.claims.map((claim) => ({
        ...claim,
        appended: stored.appended.has(claim),
      })),
      dropped,
    };
  }

  private async answerFor(
    tenantId: string,
    runId: string,
    transcriptHash: string,
    messages: readonly TranscriptMessage[],
  ): Promise<{ answer: Answer; cached: boolean }> {
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
    const reply = replySchema.safeParse(hit?.reply);
    if (hit !== undefined && reply.success) {
      return { answer: { reply: reply.data, model: hit.model }, cached: true };
    }
    // Requests for one transcript that arrive together share a single model call.
    const flight = `${tenantId}\t${runId}\t${transcriptHash}`;
    let pending = this.inflight.get(flight);
    if (pending === undefined) {
      pending = this.ask(tenantId, runId, transcriptHash, messages).finally(() => {
        this.inflight.delete(flight);
      });
      this.inflight.set(flight, pending);
    }
    return { answer: await pending, cached: false };
  }

  private async ask(
    tenantId: string,
    runId: string,
    transcriptHash: string,
    messages: readonly TranscriptMessage[],
  ): Promise<Answer> {
    const answer = await this.extractorFor().extract(messages);
    await this.db
      .insert(claimExtractions)
      .values({ tenantId, runId, transcriptHash, model: answer.model, reply: answer.reply })
      .onConflictDoNothing();
    return answer;
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
  ): Promise<{ messages: TranscriptMessage[]; truncated: number }> {
    const messages: TranscriptMessage[] = [];
    let truncated = 0;
    for (const event of events) {
      const agent = event.actor.type === 'agent' || event.actor.type === 'subagent';
      if (event.kind !== 'agent.message' || !agent || event.payloadSha256 === undefined) continue;
      const sealed = await this.blobs.get(tenantId, event.payloadSha256);
      const parsed = documentSchema.safeParse(
        sealed === undefined ? undefined : JSON.parse(new TextDecoder().decode(sealed.body)),
      );
      const said = parsed.success ? parsed.data.content[SAID] : undefined;
      if (said === undefined || said === '') continue;
      const text = said.replace(TRUNCATED, '');
      if (text !== said) truncated += 1;
      messages.push({ id: event.id, text, saidAt: event.sourceTs });
    }
    return { messages, truncated };
  }

  // Inside the tenant lock: skip claims overlapping a stored one (§18.2) and any whose text redaction changed.
  private async appendNew(
    tenantId: string,
    runId: string,
    claims: readonly Claim[],
  ): Promise<{ appended: Set<Claim>; dropped: Partial<ClaimsResponse['dropped']> }> {
    const appended = new Set<Claim>();
    const dropped = { 'changed-by-redaction': 0, invalid: 0 };
    if (claims.length === 0) return { appended, dropped };
    const ts = new Date().toISOString();
    const items: AppendItem[] = claims.map((claim) => ({
      input: { ...claimEvent(claim, runId), id: ulid(), ts, tenantId },
    }));
    const prepare: AppendPrepare = async (redacted, reader) => {
      const rows = await reader
        .select({ attrs: eventsTable.attrs })
        .from(eventsTable)
        .where(
          and(
            eq(eventsTable.tenantId, tenantId),
            eq(eventsTable.runId, runId),
            eq(eventsTable.kind, 'claim'),
          ),
        );
      const stored = rows.flatMap((row) => {
        const span = claimSpan(row.attrs);
        return span === undefined ? [] : [span];
      });
      return redacted.filter((item, index) => {
        const claim = claims[index];
        if (claim === undefined || overlapsAny(claim.span, stored)) return false;
        if (item.input.attrs['claim.text'] !== claim.text) {
          dropped['changed-by-redaction'] += 1;
          return false;
        }
        if (!eventInputSchema.safeParse(item.input).success) {
          dropped.invalid += 1;
          return false;
        }
        appended.add(claim);
        return true;
      });
    };
    // Claims carry no sourceId, so the dedupe scope is moot; overlap with a stored claim is the duplicate.
    const result = await this.events.append(tenantId, items, 'third-party', prepare);
    const last = result.events[result.events.length - 1];
    if (last !== undefined) this.checkpointer.observe(tenantId, last.seq);
    this.runs.observe(tenantId, result.events);
    return { appended, dropped };
  }
}
