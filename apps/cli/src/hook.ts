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

export const HOOK_BUDGET_MS = 1500;

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
}

// The API answers these for a batch it will never accept; resending would block the backlog forever.
const REFUSED = new Set([400, 413, 422]);

export function transcriptBatches(
  lines: readonly TranscriptLine[],
  sessionId: string,
  maxEvents: number,
  maxBytes: number,
): Batch[] {
  const batches: Batch[] = [];
  let current: Batch = { events: [] };
  let bytes = 0;
  for (const line of lines) {
    const events = lineEvents(line.text, sessionId);
    const size = events.reduce((total, event) => total + JSON.stringify(event).length, 0);
    const full = current.events.length + events.length > maxEvents || bytes + size > maxBytes;
    if (current.events.length > 0 && full) {
      batches.push(current);
      current = { events: [] };
      bytes = 0;
    }
    current.events.push(...events);
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
  const batches = transcriptBatches(
    readLines(path, state.offset, options.maxReadBytes ?? 16 * 1024 * 1024),
    session,
    options.maxBatchEvents ?? 500,
    options.maxBatchBytes ?? 768 * 1024,
  );
  const git = await readGitState(cwd, options.git);
  if (git !== undefined && gitDigest(git) !== state.git) {
    const at = new Date(now()).toISOString();
    batches.push({ events: [gitEvent(git, session, at)], git: gitDigest(git) });
  }
  for (const [index, batch] of batches.entries()) {
    const left = deadline - now();
    if (left <= 0) return { ...outcome, status: 'stopped', pending: batches.length - index };
    if (batch.events.length > 0) {
      try {
        const signal = AbortSignal.timeout(left);
        const api = { apiUrl: config.apiUrl, key: config.key, signal };
        const send = options.fetch === undefined ? api : { ...api, fetch: options.fetch };
        const result = await postEvents(send, batch.events);
        outcome.accepted += result.accepted;
        outcome.duplicates += result.duplicates;
      } catch (error) {
        if (!(error instanceof ApiError && REFUSED.has(error.status))) {
          log(
            `upload paused until the next Stop (${error instanceof Error ? error.message : 'error'})`,
          );
          return { ...outcome, status: 'stopped', pending: batches.length - index };
        }
        log(`skipped ${String(batch.events.length)} events the API refused (${error.message})`);
      }
    }
    if (batch.end !== undefined) state.offset = batch.end;
    if (batch.git !== undefined) state.git = batch.git;
    writeState(options.configDir, session, state);
  }
  return outcome;
}
