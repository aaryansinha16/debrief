import { describe, expect, it } from 'vitest';

import {
  type Draft,
  claimDraft,
  observedDraft,
  stored,
  toolCallDraft,
  ulidOf,
  verdictDraft,
} from './__fixtures__/session-events';
import { sessionCheckInputSchema } from './session-check-input';

const SESSION = 'session-test';
const at = (time: string): string => `2026-10-25T${time}.000+05:30`;
const claim = claimDraft(ulidOf('C', 1), SESSION, {
  text: 'All 12 tests pass.',
  messageId: 'msg-1',
  saidAt: at('10:00:00'),
  predicate: 'tests.passed',
  subject: { system: 'forge' },
});
const run = observedDraft(ulidOf('W', 1), {
  at: at('10:01:00'),
  target: { system: 'forge', operation: 'workflow_run.completed' },
  trust: 'third-party',
  summary: 'CI run finished',
});
const call = toolCallDraft(ulidOf('T', 1), SESSION, at('09:59:00'), 'deploy');
const verdict = verdictDraft(ulidOf('V', 1), SESSION, {
  claimId: claim.id,
  outcome: 'holds',
  trust: 'third-party',
  evidence: [run.id],
  checker: 'tests.passed@1',
  reason: 'The report has 12 passed.',
  at: at('10:02:00'),
});

const input = (drafts: readonly Draft[], patch: Record<string, unknown> = {}) => ({
  session: { id: SESSION, agent: 'claude-code', startedAt: at('09:58:00'), sample: true },
  events: stored(drafts),
  sideEffects: [{ worldEventId: run.id, toolCallId: call.id, confidence: 'exact' }],
  witnesses: [{ state: 'connected', system: 'forge', trust: 'third-party', observed: 1 }],
  ...patch,
});

const messages = (value: unknown): string[] => {
  const result = sessionCheckInputSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe('sessionCheckInputSchema', () => {
  it('accepts a session whose every cited id is in the payload', () => {
    expect(messages(input([claim, run, call, verdict]))).toEqual([]);
  });

  it('refuses claims and verdicts of another session', () => {
    expect(messages(input([{ ...claim, runId: 'other' }, run, call, verdict]))).toEqual([
      'claim of another session',
    ]);
  });

  it('refuses a verdict whose claim or evidence is missing, or whose evidence is not observed', () => {
    expect(messages(input([run, call, verdict]))).toEqual(['verdict for a claim not in the check']);
    expect(messages(input([claim, call, verdict]))).toContain(`evidence ${run.id} is not observed`);
    const cites = verdictDraft(verdict.id, SESSION, {
      claimId: claim.id,
      outcome: 'holds',
      trust: 'local',
      evidence: [call.id],
      checker: 'tests.passed@1',
      reason: 'The agent said so.',
      at: at('10:02:00'),
    });
    expect(messages(input([claim, run, call, cites]))).toEqual([
      `evidence ${call.id} is not observed`,
    ]);
  });
});
