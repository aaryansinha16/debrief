import type { SessionCheckInput } from '../session-check-input';
import { sessionCheckInputSchema } from '../session-check-input';
import {
  type Draft,
  type VerdictDraft,
  claimDraft,
  observedDraft,
  stored,
  ulidOf,
  verdictDraft,
} from './session-events';

// One claim in every state the check knows, on the invented systems of lib/systems.ts.
export const SESSION = 'session-test';
export const at = (time: string): string => `2026-10-25T${time}.000+05:30`;
export const said = (n: number, text: string, system: string, extra: object = {}): Draft =>
  claimDraft(ulidOf('C', n), SESSION, {
    text,
    messageId: `msg-${String(n)}`,
    saidAt: at(`10:0${String(n)}:00`),
    predicate: 'tests.passed',
    subject: { system },
    ...extra,
  });
export const seen = (n: number, system: string, trust: 'local' | 'third-party'): Draft =>
  observedDraft(ulidOf('W', n), {
    at: at('10:20:00'),
    target: { system, operation: 'run' },
    trust,
    summary: `witness record ${String(n)}`,
  });
export const judged = (
  n: number,
  verdict: Omit<VerdictDraft, 'checker' | 'reason' | 'at'>,
): Draft =>
  verdictDraft(ulidOf('V', n), SESSION, {
    checker: 'tests.passed@1',
    reason: `reason ${String(n)}`,
    at: at(`10:3${String(n)}:00`),
    ...verdict,
  });

export const claims = {
  late: said(1, 'Deploy is live.', 'vercel'),
  local: said(2, 'Removed the flag.', 'git'),
  broken: said(3, 'All 9 tests pass.', 'github', { params: { passed: 9 } }),
  unseen: said(4, 'Rotated the key.', 'secrets'),
  waiting: said(5, 'Opened PR #4.', 'github'),
  hedged: said(6, 'It should stay green.', 'github', { modality: 'hedged' }),
  held: said(7, 'Migrated staging.', 'neon'),
};
export const evidence = [
  seen(1, 'vercel', 'third-party'),
  seen(2, 'git', 'local'),
  seen(3, 'github', 'third-party'),
];
export const [deploy, diff, ci] = evidence.map((event) => event.id);
export const verdicts = [
  judged(1, { claimId: claims.late.id, outcome: 'no-witness' }),
  judged(2, {
    claimId: claims.late.id,
    outcome: 'holds',
    trust: 'third-party',
    evidence: [deploy ?? ''],
    supersedes: ulidOf('V', 1),
  }),
  judged(3, { claimId: claims.local.id, outcome: 'holds', trust: 'local', evidence: [diff ?? ''] }),
  judged(4, {
    claimId: claims.broken.id,
    outcome: 'contradicted',
    trust: 'third-party',
    evidence: [ci ?? ''],
  }),
  judged(5, { claimId: claims.unseen.id, outcome: 'no-witness' }),
  judged(6, { claimId: claims.hedged.id, outcome: 'no-witness' }),
  judged(7, {
    claimId: claims.held.id,
    outcome: 'holds',
    trust: 'third-party',
    evidence: [ci ?? ''],
  }),
];

export const input = (drafts: readonly Draft[]): SessionCheckInput =>
  sessionCheckInputSchema.parse({
    session: { id: SESSION, agent: 'coding-agent', startedAt: at('10:00:00'), sample: false },
    events: stored(drafts),
    sideEffects: [],
    witnesses: ['vercel', 'git', 'github', 'neon'].map((system) => ({
      state: 'connected',
      system,
      trust: system === 'git' ? 'local' : 'third-party',
      observed: 1,
    })),
  });
export const all = [...Object.values(claims), ...evidence, ...verdicts];
