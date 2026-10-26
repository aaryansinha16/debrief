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
  subject: { system: 'github' },
});
const run = observedDraft(ulidOf('W', 1), {
  at: at('10:01:00'),
  target: { system: 'github', operation: 'pipeline.finished' },
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
  witnesses: [{ state: 'connected', system: 'github', trust: 'third-party', observed: 1 }],
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
    const witnesses = [{ state: 'connected', system: 'github', observed: 1 }];
    expect(messages(input([claim, run, call, verdict], { witnesses }))).toHaveLength(1);
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

  it('refuses a third-party verdict unless every record it cites is third-party', () => {
    const diff = observedDraft(ulidOf('W', 2), {
      at: at('10:01:30'),
      target: { system: 'git', operation: 'git.state' },
      trust: 'local',
      summary: 'local diff',
      runId: SESSION,
    });
    const local = (trust: 'local' | 'third-party', evidence = [diff.id]): Draft =>
      verdictDraft(verdict.id, SESSION, {
        claimId: claim.id,
        outcome: 'holds',
        trust,
        evidence,
        checker: 'tests.passed@1',
        reason: 'The diff says so.',
        at: at('10:02:00'),
      });
    expect(messages(input([claim, run, diff, call, local('local')]))).toEqual([]);
    const refused = ['a third-party verdict cites a record that is not'];
    expect(messages(input([claim, run, diff, call, local('third-party')]))).toEqual(refused);
    const mixed = local('third-party', [run.id, diff.id]);
    expect(messages(input([claim, run, diff, call, mixed]))).toEqual(refused);
    expect(messages(input([claim, run, diff, call, local('local', [run.id, diff.id])]))).toEqual(
      [],
    );
  });

  it('refuses a verdict superseding a later one, one of another claim or one not in the payload', () => {
    const later = (supersedes: string): Draft =>
      verdictDraft(ulidOf('V', 2), SESSION, {
        claimId: claim.id,
        outcome: 'no-witness',
        checker: 'tests.passed@1',
        reason: 'No report.',
        at: at('10:03:00'),
        supersedes,
      });
    expect(messages(input([claim, run, call, verdict, later(verdict.id)]))).toEqual([]);
    expect(messages(input([claim, run, call, verdict, later(ulidOf('V', 9))]))).toHaveLength(1);
    expect(messages(input([claim, run, call, later(verdict.id), verdict]))).toEqual([
      'supersedes no earlier verdict of the same claim',
    ]);
    const other = claimDraft(ulidOf('C', 2), SESSION, {
      text: 'Opened PR #3.',
      messageId: 'msg-2',
      saidAt: at('10:00:30'),
      predicate: 'pr.opened',
      subject: { system: 'github' },
    });
    const foreign = verdictDraft(ulidOf('V', 3), SESSION, {
      claimId: other.id,
      outcome: 'no-witness',
      checker: 'tests.passed@1',
      reason: 'No report.',
      at: at('10:03:00'),
    });
    expect(messages(input([claim, other, run, call, verdict, foreign, later(foreign.id)]))).toEqual(
      ['supersedes no earlier verdict of the same claim'],
    );
  });

  it('refuses side effects that do not join an observed change to a reported tool call', () => {
    expect(
      messages(
        input([claim, run, call, verdict], {
          sideEffects: [{ worldEventId: call.id, toolCallId: run.id, confidence: 'weak' }],
        }),
      ),
    ).toEqual(['not an observed world change', 'not a reported tool call of this session']);
  });

  it('refuses local git state as a side effect, and a tool call of another session', () => {
    const diff = observedDraft(ulidOf('W', 2), {
      at: at('10:01:30'),
      target: { system: 'git', operation: 'git.state' },
      trust: 'local',
      summary: 'local diff',
      runId: SESSION,
    });
    const elsewhere = toolCallDraft(ulidOf('T', 2), 'session-other', at('09:59:30'), 'deploy');
    expect(
      messages(
        input([claim, run, diff, call, elsewhere, verdict], {
          sideEffects: [
            { worldEventId: diff.id, toolCallId: call.id, confidence: 'exact' },
            { worldEventId: run.id, toolCallId: elsewhere.id, confidence: 'strong' },
          ],
        }),
      ),
    ).toEqual(['local git is never a side effect', 'not a reported tool call of this session']);
  });

  it('refuses a roster that lists a system twice', () => {
    const missing = { state: 'missing', system: 'github' };
    expect(
      messages(
        input([claim, run, call, verdict], {
          witnesses: [
            { state: 'connected', system: 'github', trust: 'local', observed: 0 },
            missing,
          ],
        }),
      ),
    ).toEqual(['a system is listed twice']);
  });
});
