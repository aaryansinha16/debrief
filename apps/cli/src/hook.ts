import { z } from 'zod';

import { ApiError, postEvents } from './api.js';
import { readConfig } from './config.js';
import { type GitRunner, gitDigest, gitEvent, readGitState } from './git.js';
import {
  SESSION_ID,
  type TranscriptLine,
  readLines,
  readState,
  writeState,
} from './session-state.js';
import { lineEvents } from './transcript.js';
import type { WireEvent } from './wire.js';

export const HOOK_BUDGET_MS = 1000;

export const hookInputSchema = z.looseObject({
  session_id: z.string().regex(SESSION_ID),
  transcript_path: z.string().min(1),
  cwd: z.string().min(1),
});

export interface HookOptions {
  configDir: string;
  fetch?: typeof fetch;
  git?: GitRunner;
  now?: () => number;
  log?: (line: string) => void;
  budgetMs?: number;
  maxBatchEvents?: number;
  maxBatchBytes?: number;
  maxReadBytes?: number;
}

export interface HookOutcome {
  status: 'not-installed' | 'bad-input' | 'done' | 'stopped';
  accepted: number;
  duplicates: number;
  pending: number;
}

interface Batch {
  events: WireEvent[];
  end?: number;
  git?: string;
  lines?: Batch[];
}

// The API answers these for a batch it will never accept; resending would block the backlog forever.
const REFUSED = new Set([400, 413, 422]);

const reason = (error: unknown): string => (error instanceof Error ? error.message : 'error');

export function transcriptBatches(
  lines: readonly TranscriptLine[],
  sessionId: string,
  maxEvents: number,
  maxBytes: number,
): Batch[] {
  const batches: Batch[] = [];
  let current: Batch = { events: [], lines: [] };
  let bytes = 0;
  for (const line of lines) {
    const events = lineEvents(line.text, sessionId);
    const size = events.reduce(
      (total, event) => total + Buffer.byteLength(JSON.stringify(event)),
      0,
    );
    const full = current.events.length + events.length > maxEvents || bytes + size > maxBytes;
    if (current.events.length > 0 && full) {
      batches.push(current);
      current = { events: [], lines: [] };
      bytes = 0;
    }
    current.events.push(...events);
    current.lines?.push({ events, end: line.end });
    current.end = line.end;
    bytes += size;
  }
  if (current.end !== undefined) batches.push(current);
  return batches;
}

// ARCHITECTURE §18.2: never blocks or fails a turn; whatever misses the deadline goes with the next Stop.
export async function runHook(input: unknown, options: HookOptions): Promise<HookOutcome> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? HOOK_BUDGET_MS);
  const log = options.log ?? ((line: string) => process.stderr.write(`debrief: ${line}\n`));
  const outcome: HookOutcome = { status: 'done', accepted: 0, duplicates: 0, pending: 0 };
  const config = readConfig(options.configDir);
  if (config === undefined) return { ...outcome, status: 'not-installed' };
  const parsed = hookInputSchema.safeParse(input);
  if (!parsed.success) return { ...outcome, status: 'bad-input' };
  const { session_id: session, transcript_path: path, cwd } = parsed.data;
  const state = readState(options.configDir, session);
  let saving = true;
  const advance = (batch: Batch): void => {
    if (batch.end !== undefined) state.offset = batch.end;
    if (batch.git !== undefined) {
      state.git = batch.git;
      state.gitSeq = (state.gitSeq ?? 0) + 1;
    }
    if (!saving) return;
    try {
      writeState(options.configDir, session, state);
    } catch (error) {
      saving = false;
      log(`cannot save progress; it is resent with the next Stop (${reason(error)})`);
    }
  };
  const send = async (batch: Batch): Promise<'sent' | 'refused' | 'paused'> => {
    const left = deadline - now();
    if (left <= 0) return 'paused';
    if (batch.events.length === 0) return 'sent';
    const api = { apiUrl: config.apiUrl, key: config.key, signal: AbortSignal.timeout(left) };
    try {
      const result = await postEvents(
        options.fetch === undefined ? api : { ...api, fetch: options.fetch },
        batch.events,
      );
      outcome.accepted += result.accepted;
      outcome.duplicates += result.duplicates;
      return 'sent';
    } catch (error) {
      if (error instanceof ApiError && REFUSED.has(error.status)) return 'refused';
      log(`upload paused until the next Stop (${reason(error)})`);
      return 'paused';
    }
  };
  const queue = transcriptBatches(
    readLines(path, state.offset, options.maxReadBytes ?? 16 * 1024 * 1024),
    session,
    options.maxBatchEvents ?? 500,
    options.maxBatchBytes ?? 768 * 1024,
  );
  for (let at = 0; at < queue.length; at += 1) {
    const batch = queue[at] ?? { events: [] };
    const result = await send(batch);
    if (result === 'paused') return { ...outcome, status: 'stopped', pending: queue.length - at };
    if (result === 'refused' && (batch.lines?.length ?? 0) > 1) {
      queue.splice(at + 1, 0, ...(batch.lines ?? []));
      continue;
    }
    if (result === 'refused') log(`skipped ${String(batch.events.length)} events the API refused`);
    advance(batch);
  }
  // Git runs last, inside what is left: its three phases must fit, or the state waits for the next Stop.
  const left = deadline - now();
  const git = left > 0 ? await readGitState(cwd, options.git, Math.floor(left / 3)) : undefined;
  if (git === undefined || gitDigest(git) === state.git) return outcome;
  const at = new Date(now()).toISOString();
  const batch = { events: [gitEvent(git, session, at, state.gitSeq)], git: gitDigest(git) };
  const result = await send(batch);
  if (result === 'paused') return { ...outcome, status: 'stopped', pending: 1 };
  if (result === 'refused') log('skipped the git state the API refused');
  advance(batch);
  return outcome;
}
