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
  recordedMatches,
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

import { CheckpointerService } from '../checkpoints/checkpointer.service.js';
import { ClaimsService } from '../claims/claims.service.js';
import { CONFIG, type Config } from '../config/config.js';
import { type AppendItem, EventsRepository } from '../events/events.repository.js';
import { ulid } from '../ids/ulid.js';
import { RunsService } from '../runs/runs.service.js';
import {
  type Span,
  type WitnessSummary,
  dedupeById,
  isSessionEvent,
  sessionWindow,
  sourceMillis,
  verdictSourceId,
  witnessesOf,
} from './session-check.js';
import { SessionsRepository } from './sessions.repository.js';

const PAGE = 1000;
const MAX_EVENTS = 50_000;
// A session's window never spans more than a day, whatever its reported events say (D-091).
const MAX_SPAN_MS = 24 * 60 * 60 * 1000;

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

function observedSpan(appended: readonly Event[]): Span | undefined {
  let span: Span | undefined;
  for (const event of appended) {
    if (event.provenance !== 'observed') continue;
    const at = sourceMillis(event);
    if (at === undefined) continue;
    span =
      span === undefined
        ? { from: at, to: at }
        : { from: Math.min(span.from, at), to: Math.max(span.to, at) };
  }
  return span;
}

// ARCHITECTURE §18.2 and §18.4: the check runs when a session settles and again when a witness lands in its window.
@Injectable()
export class SessionsService implements OnModuleDestroy {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly chains = new Map<string, Promise<void>>();
  private readonly lookups = new Set<Promise<void>>();

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly events: EventsRepository,
    private readonly sessions: SessionsRepository,
    private readonly claims: ClaimsService,
    private readonly runs: RunsService,
    private readonly checkpointer: CheckpointerService,
    private readonly logger: Logger,
  ) {}

  observe(tenantId: string, appended: readonly Event[]): void {
    for (const runId of new Set(appended.filter(isSessionEvent).map((event) => event.runId))) {
      this.schedule(tenantId, runId);
    }
    const span = observedSpan(appended);
    if (span === undefined) return;
    // One lookup per batch, owned here so a failure is logged and never left unhandled.
    const lookup: Promise<void> = this.sessions
      .around(
        tenantId,
        span,
        this.config.SESSION_WINDOW_BEFORE_MS,
        this.config.SESSION_WINDOW_AFTER_MS,
      )
      .then((found) => {
        for (const runId of found) this.schedule(tenantId, runId);
      })
      .catch((error: unknown) => {
        this.logger.error({ err: error, tenantId }, 'session lookup failed');
      })
      .finally(() => {
        this.lookups.delete(lookup);
      });
    this.lookups.add(lookup);
  }

  private schedule(tenantId: string, runId: string): void {
    const key = keyOf(tenantId, runId);
    const existing = this.timers.get(key);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      void this.guarded(tenantId, runId);
    }, this.config.SESSION_SETTLE_MS);
    timer.unref();
    this.timers.set(key, timer);
  }

  private guarded(tenantId: string, runId: string): Promise<void> {
    return this.runCheck(tenantId, runId).then(
      () => undefined,
      (error: unknown) => {
        this.logger.error({ err: error, tenantId, runId }, 'session check failed');
      },
    );
  }

  // Checks of one session run one after another, so two never compute `supersedes` against the same prior.
  runCheck(tenantId: string, runId: string): Promise<SessionCheck> {
    const key = keyOf(tenantId, runId);
    const previous = this.chains.get(key) ?? Promise.resolve();
    const work = (): Promise<SessionCheck> => this.check(tenantId, runId);
    const next = previous.then(work);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.chains.set(key, settled);
    void settled.then(() => {
      if (this.chains.get(key) === settled) this.chains.delete(key);
    });
    return next;
  }

  // Tests: let pending lookups schedule their checks, then run every pending check now.
  async settle(): Promise<void> {
    await Promise.all([...this.lookups]);
    const pending: Promise<void>[] = [];
    for (const [key, timer] of this.timers) {
      clearTimeout(timer);
      this.timers.delete(key);
      const [tenantId, runId] = JSON.parse(key) as [string, string];
      pending.push(this.guarded(tenantId, runId));
    }
    await Promise.all([...pending, ...this.chains.values()]);
  }

  // Read-only: what the record says now, with verdicts not yet appended marked by a missing eventId.
  async read(tenantId: string, runId: string): Promise<SessionCheck> {
    const { all, window, messages } = await this.gather(tenantId, runId);
    return this.assemble(runId, all, window, messages, 0);
  }

  // The check: extract claims when a model is configured, append what the record lacks, then report.
  private async check(tenantId: string, runId: string): Promise<SessionCheck> {
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
      const last = appended[appended.length - 1];
      if (last !== undefined) this.checkpointer.observe(tenantId, last.seq);
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
      maxSpanMs: MAX_SPAN_MS,
    });
    if (messages === 0 || window === undefined) throw new NotFoundException('session not found');
    const observed = await this.sessions.observedSince(tenantId, Date.parse(window.from));
    if (observed.truncated) {
      this.logger.warn({ tenantId, runId }, 'observed events truncated for the check');
    }
    const all = dedupeById([...own, ...observed.events.filter((event) => inWindow(event, window))]);
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
      return last !== undefined && recordedMatches(last, verdict)
        ? { ...verdict, eventId: last.id }
        : verdict;
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

  // Bounded: a run past MAX_EVENTS is checked on its first pages and logged, never read whole.
  private async runEvents(tenantId: string, runId: string): Promise<Event[]> {
    const all: Event[] = [];
    for (let from = 0; all.length < MAX_EVENTS;) {
      const page = await this.events.listByRun(tenantId, runId, from, undefined, PAGE);
      all.push(...page);
      const last = page[page.length - 1];
      if (page.length < PAGE || last === undefined) return all;
      from = last.seq + 1;
    }
    this.logger.warn({ tenantId, runId, limit: MAX_EVENTS }, 'session truncated for the check');
    return all;
  }

  // Pending checks are dropped on shutdown; a POST or the next witness event brings them back (D-091).
  onModuleDestroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
