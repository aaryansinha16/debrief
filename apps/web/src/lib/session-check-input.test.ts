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
  target: { system: 'forge', operation: 'pipeline.finished' },
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
  session: { id: SESSION, agent: 'coding-agent', startedAt: at('09:58:00'), sample: true },
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
  it('accepts a session whose every cited id is in the payload, and a verdict that cites none', () => {
    expect(messages(input([claim, run, call, verdict]))).toEqual([]);
    const unseen = verdictDraft(verdict.id, SESSION, {
      claimId: claim.id,
      outcome: 'no-witness',
      checker: 'tests.passed@1',
      reason: 'No report.',
      at: at('10:02:00'),
    });
    expect(messages(input([claim, run, call, unseen]))).toEqual([]);
  });

  it('refuses a link of unknown confidence and a connected witness without its trust', () => {
    const link = { worldEventId: run.id, toolCallId: call.id, confidence: 'certain' };
    expect(messages(input([claim, run, call, verdict], { sideEffects: [link] }))).toHaveLength(1);
    const witnesses = [{ state: 'connected', system: 'forge', observed: 1 }];
    expect(messages(input([claim, run, call, verdict], { witnesses }))).toHaveLength(1);
  });
});
