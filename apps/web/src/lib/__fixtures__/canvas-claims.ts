import type { VerdictValue } from '../../components/verdict';
import { type ClaimDraft } from './session-events';

export const CANVAS_SESSION_ID = 'session-canvas';

const at = (time: string): string => `2026-10-25T${time}.000+05:30`;

// claim-check.dc.html's seven claims as @debrief/claims extracts them (P-63), on invented systems (D-079).
export const CLAIMS: Omit<ClaimDraft, 'messageId'>[] = [
  {
    text: 'Migration 0042 is applied on staging.',
    saidAt: at('14:12:18'),
    predicate: 'migration.applied',
    subject: { system: 'tidewater', environment: 'staging' },
    params: { name: '0042' },
  },
  {
    text: 'Removed the unused feature flag.',
    saidAt: at('14:18:33'),
    predicate: 'code.removed',
    subject: { system: 'git', resource: 'src/flags.ts' },
  },
  {
    text: 'Rotated the leaked API key',
    saidAt: at('14:24:50'),
    predicate: 'secret.rotated',
    subject: { system: 'secrets' },
  },
  {
    text: 'All 142 tests pass.',
    saidAt: at('14:27:40'),
    predicate: 'tests.passed',
    subject: { system: 'forge' },
    params: { passed: 142 },
  },
  {
    text: 'I only touched the staging database.',
    saidAt: at('14:29:02'),
    predicate: 'db.scope',
    subject: { system: 'tidewater', environment: 'staging' },
    params: { environment: 'staging' },
  },
  {
    text: 'Opened PR #311 with the fix.',
    saidAt: at('14:30:11'),
    predicate: 'pr.opened',
    subject: { system: 'forge' },
    params: { number: 311 },
  },
  {
    text: 'Preview deploy is live.',
    saidAt: at('14:30:55'),
    predicate: 'deploy.ready',
    subject: { system: 'skyport' },
    params: { target: 'preview' },
  },
];

// A witnessed claim names the witness that observed it; a claim without a witness names the one that is missing.
export type CanvasClaim = { said: string; saidAt: string; world: string } & (
  | { verdict: Exclude<VerdictValue, { outcome: 'no-witness' }>; source: string }
  | { verdict: { outcome: 'no-witness' }; missing: string }
);

// The seven claims of docs/design/artboards/claim-check.dc.html with invented system names (D-079 keeps vendor
// names out of web fixtures); the feature flag is checked against the local git diff alone, so it carries local trust.
export const CANVAS_CLAIMS: readonly CanvasClaim[] = [
  {
    said: 'All 142 tests pass.',
    saidAt: '14:27:40',
    verdict: { outcome: 'contradicted', trust: 'third-party' },
    world: '139 passed. 3 were skipped.',
    source: 'Forge CI · run #4182',
  },
  {
    said: 'I only touched the staging database.',
    saidAt: '14:29:02',
    verdict: { outcome: 'contradicted', trust: 'third-party' },
    world: 'Production changed. 1,204 rows.',
    source: 'Tidewater audit log · branch main',
  },
  {
    said: 'Migration 0042 is applied on staging.',
    saidAt: '14:12:18',
    verdict: { outcome: 'holds', trust: 'third-party' },
    world: 'Present on staging.',
    source: 'Tidewater · branch staging',
  },
  {
    said: 'Opened PR #311 with the fix.',
    saidAt: '14:30:11',
    verdict: { outcome: 'holds', trust: 'third-party' },
    world: 'PR #311 open, 6 files.',
    source: 'Forge',
  },
  {
    said: 'Preview deploy is live.',
    saidAt: '14:30:55',
    verdict: { outcome: 'holds', trust: 'third-party' },
    world: 'Ready in 41 s, returns 200.',
    source: 'Skyport',
  },
  {
    said: 'Removed the unused feature flag.',
    saidAt: '14:18:33',
    verdict: { outcome: 'holds', trust: 'local' },
    world: 'Gone from src/flags.ts.',
    source: 'local git diff',
  },
  {
    said: 'Rotated the leaked API key.',
    saidAt: '14:24:50',
    verdict: { outcome: 'no-witness' },
    world: 'Nothing is watching the secrets manager.',
    missing: 'Secrets manager',
  },
];
