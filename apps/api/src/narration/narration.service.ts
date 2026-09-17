import Anthropic from '@anthropic-ai/sdk';
import type { Event } from '@debrief/schema';
import {
  BadGatewayException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';

import { CONFIG, type Config } from '../config/config.js';
import { DB, type Db } from '../db/db.module.js';
import { narratives } from '../db/schema.js';
import { ReconstructionService } from '../reconstruction/reconstruction.service.js';
import {
  type Narrative,
  type NarrativeSentence,
  eventsHash,
  feedback,
  narrationEvents,
  parseNarrative,
  SYSTEM_PROMPT,
  userPrompt,
  validateNarrative,
} from './narrative.js';

export interface NarrativeResponse {
  runId: string;
  eventsHash: string;
  model: string;
  sentences: NarrativeSentence[];
  generatedAt: string;
  cached: boolean;
}

export interface Narrator {
  complete(messages: Anthropic.MessageParam[]): Promise<{ text: string; model: string }>;
}

const MAX_ATTEMPTS = 2;

// The only model call in the product (NFR-4): opt-in per request, cached by run and events hash, never on the ingest or reconstruction path.
@Injectable()
export class NarrationService {
  private narrator: Narrator | undefined;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: Db,
    private readonly reconstruction: ReconstructionService,
    private readonly logger: Logger,
  ) {}

  // Built lazily from the key, so a missing key costs nothing until someone asks for a narrative.
  private narratorFor(): Narrator {
    if (this.narrator !== undefined) return this.narrator;
    const apiKey = this.config.ANTHROPIC_API_KEY;
    if (apiKey === undefined) {
      throw new ServiceUnavailableException('narration is not configured: set ANTHROPIC_API_KEY');
    }
    const client = new Anthropic({ apiKey });
    const model = this.config.NARRATION_MODEL;
    this.narrator = {
      complete: async (messages) => {
        const response = await client.messages.create({
          model,
          max_tokens: 4000,
          thinking: { type: 'adaptive' },
          system: SYSTEM_PROMPT,
          messages,
        });
        const text = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('\n');
        return { text, model: response.model };
      },
    };
    return this.narrator;
  }

  async narrate(tenantId: string, runId: string): Promise<NarrativeResponse> {
    const loaded = await this.reconstruction.load(tenantId, runId);
    const inRun = loaded.events.filter((event) => event.runId === runId);
    const hash = eventsHash(inRun);
    const cached = await this.db
      .select()
      .from(narratives)
      .where(
        and(
          eq(narratives.tenantId, tenantId),
          eq(narratives.runId, runId),
          eq(narratives.eventsHash, hash),
        ),
      )
      .limit(1);
    const hit = cached[0];
    if (hit !== undefined) {
      return {
        runId,
        eventsHash: hash,
        model: hit.model,
        sentences: hit.sentences,
        generatedAt: hit.createdAt,
        cached: true,
      };
    }
    const narrator = this.narratorFor();
    const { narrative, model } = await this.generate(narrator, inRun);
    const [row] = await this.db
      .insert(narratives)
      .values({ tenantId, runId, eventsHash: hash, model, sentences: narrative.sentences })
      .onConflictDoNothing()
      .returning();
    this.logger.log(
      { tenantId, runId, sentences: narrative.sentences.length, model },
      'narrative generated',
    );
    return {
      runId,
      eventsHash: hash,
      model,
      sentences: narrative.sentences,
      generatedAt: row?.createdAt ?? new Date().toISOString(),
      cached: false,
    };
  }

  // One corrective turn: a rejected answer goes back with its problems; a second rejection is the caller's 502.
  private async generate(
    narrator: Narrator,
    events: readonly Event[],
  ): Promise<{ narrative: Narrative; model: string }> {
    const knownIds = new Set(events.map((event) => event.id));
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: userPrompt(narrationEvents(events, this.config.NARRATION_MAX_EVENTS)),
      },
    ];
    let problems: string[] = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const answer = await narrator.complete(messages);
      const narrative = parseNarrative(answer.text);
      problems =
        narrative === undefined
          ? ['the answer was not the JSON shape requested']
          : validateNarrative(narrative, knownIds);
      if (narrative !== undefined && problems.length === 0) {
        return { narrative, model: answer.model };
      }
      this.logger.warn({ attempt, problems: problems.length }, 'narrative rejected');
      messages.push({ role: 'assistant', content: answer.text });
      messages.push({ role: 'user', content: feedback(problems) });
    }
    throw new BadGatewayException(`narrative rejected: ${problems.join('; ')}`);
  }
}
