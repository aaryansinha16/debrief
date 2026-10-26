import { buildGraph } from '@debrief/reconstruct';
import { type Event, eventInputSchema } from '@debrief/schema';
import {
  type ClaimRecord,
  type SideEffects,
  type Verdict,
  type Window,
  claimsOf,
  inWindow,
  pendingVerdicts,
  priorVerdicts,
  sideEffects,
  verdictEvent,
  verdicts,
} from '@debrief/verdict';
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { ulid } from '../ids/ulid.js';

import { ClaimsService } from '../claims/claims.service.js';
import { CONFIG, type Config } from '../config/config.js';
import { type AppendItem, EventsRepository } from '../events/events.repository.js';
import { RunsService } from '../runs/runs.service.js';
import {
  type WitnessSummary,
  dedupeById,
  isSessionEvent,
  sessionWindow,
  verdictSourceId,
  witnessesOf,
} from './session-check.js';
import { SessionsRepository } from './sessions.repository.js';

const PAGE = 1000;

export interface RecordedVerdict extends Verdict {
  eventId?: string;
}

export interface SessionCheck {
  session: { id: string; window: Window; messages: number };
  claims: ClaimRecord[];
  verdicts: RecordedVerdict[];
  sideEffects: SideEffects;
  witnesses: WitnessSummary[];
  appended: number;
}

const keyOf = (tenantId: string, runId: string): string => JSON.stringify([tenantId, runId]);

// ARCHITECTURE §18.2 and §18.4: the check runs when a session settles and again when a witness lands in its window.
@Injectable()
export class SessionsService implements OnModuleDestroy {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private inflight: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly events: EventsRepository,
    private readonly sessions: SessionsRepository,
    private readonly claims: ClaimsService,
    private readonly runs: RunsService,
    private readonly logger: Logger,
  ) {}

  observe(tenantId: string, appended: readonly Event[]): void {
    for (const runId of new Set(appended.filter(isSessionEvent).map((event) => event.runId))) {
      this.schedule(tenantId, runId);
    }
    const observed = appended.filter((event) => event.provenance === 'observed');
    if (observed.length === 0) return;
    const lookups = observed.map((event) =>
      this.sessions.around(
        tenantId,
        event.sourceTs,
        this.config.SESSION_WINDOW_BEFORE_MS,
        this.config.SESSION_WINDOW_AFTER_MS,
      ),
    );
    this.inflight = this.inflight
      .then(() => Promise.all(lookups))
      .then((found) => {
        for (const runId of new Set(found.flat())) this.schedule(tenantId, runId);
      })
      .catch((error: unknown) => {
        this.logger.error({ err: error, tenantId }, 'session lookup failed');
      });
  }

  private schedule(tenantId: string, runId: string): void {
    const key = keyOf(tenantId, runId);
    const existing = this.timers.get(key);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      this.inflight = this.inflight
        .then(() => this.check(tenantId, runId))
        .catch((error: unknown) => {
          this.logger.error({ err: error, tenantId, runId }, 'session check failed');
        });
    }, this.config.SESSION_SETTLE_MS);
    timer.unref();
    this.timers.set(key, timer);
  }

  // Tests and shutdown: let pending lookups schedule their checks, then run every pending check now.
  async settle(): Promise<void> {
    await this.inflight;
    for (const [key, timer] of this.timers) {
      clearTimeout(timer);
      this.timers.delete(key);
      const [tenantId, runId] = JSON.parse(key) as [string, string];
      this.inflight = this.inflight
        .then(() => this.check(tenantId, runId))
        .catch((error: unknown) => {
          this.logger.error({ err: error, tenantId, runId }, 'session check failed');
        });
    }
    await this.inflight;
  }

  // Read-only: what the record says now, with verdicts not yet appended marked by a missing eventId.
  async read(tenantId: string, runId: string): Promise<SessionCheck> {
    const { all, window, messages } = await this.gather(tenantId, runId);
    return this.assemble(runId, all, window, messages, 0);
  }

  // The check: extract claims when a model is configured, append what the record lacks, then report.
  async check(tenantId: string, runId: string): Promise<SessionCheck> {
    await this.extractClaims(tenantId, runId);
    const { all, window, messages } = await this.gather(tenantId, runId);
    const pending = pendingVerdicts({ events: all, window });
    const claims = claimsOf(all);
    const now = new Date().toISOString();
    const items: AppendItem[] = pending.map((verdict) => {
      const claim = claims.find((candidate) => candidate.id === verdict.claimId);
      if (claim === undefined) throw new InternalServerErrorException('verdict without its claim');
      const input = { ...verdictEvent(verdict, claim, runId, now), id: ulid(), ts: now, tenantId };
      const parsed = eventInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new InternalServerErrorException(
          `verdict event invalid: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        );
      }
      return { input: parsed.data, sourceId: verdictSourceId(verdict) };
    });
    let appended: Event[] = [];
    if (items.length > 0) {
      const result = await this.events.append(tenantId, items, 'third-party');
      appended = result.events;
      this.runs.observe(tenantId, appended);
      this.logger.log(
        { tenantId, runId, appended: appended.length, duplicates: result.duplicates },
        'session checked',
      );
    }
    return this.assemble(runId, [...all, ...appended], window, messages, appended.length);
  }

  private async extractClaims(tenantId: string, runId: string): Promise<void> {
    if (this.config.ANTHROPIC_API_KEY === undefined) return;
    try {
      await this.claims.extract(tenantId, runId);
    } catch (error: unknown) {
      this.logger.warn({ err: error, tenantId, runId }, 'claim extraction skipped');
    }
  }

  private async gather(
    tenantId: string,
    runId: string,
  ): Promise<{ all: Event[]; window: Window; messages: number }> {
    const own = await this.runEvents(tenantId, runId);
    const messages = own.filter(isSessionEvent).length;
    const window = sessionWindow(own, {
      beforeMs: this.config.SESSION_WINDOW_BEFORE_MS,
      afterMs: this.config.SESSION_WINDOW_AFTER_MS,
    });
    if (messages === 0 || window === undefined) throw new NotFoundException('session not found');
    const observed = await this.sessions.observedBetween(tenantId, window.from, window.to);
    const all = dedupeById([...own, ...observed.filter((event) => inWindow(event, window))]);
    return { all, window, messages };
  }

  private assemble(
    runId: string,
    all: readonly Event[],
    window: Window,
    messages: number,
    appended: number,
  ): SessionCheck {
    const claims = claimsOf(all);
    const recorded = priorVerdicts(all);
    const current = verdicts({ events: all, window }).map((verdict): RecordedVerdict => {
      const last = recorded.get(verdict.claimId);
      const same =
        last?.outcome === verdict.outcome &&
        last.evidence === verdict.evidence.join(',') &&
        last.checker === verdict.checker;
      return same ? { ...verdict, eventId: last.id } : verdict;
    });
    const graph = buildGraph(all, { runId });
    const observed = all.filter(
      (event) => event.provenance === 'observed' && inWindow(event, window),
    );
    return {
      session: { id: runId, window, messages },
      claims,
      verdicts: current,
      sideEffects: sideEffects(claims, all, graph, window),
      witnesses: witnessesOf(observed),
      appended,
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
    return all;
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
