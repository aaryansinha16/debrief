import type { VerdictValue } from '../../components/verdict';

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
