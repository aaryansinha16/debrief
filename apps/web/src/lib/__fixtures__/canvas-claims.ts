import type { VerdictValue } from '../../components/verdict';

export interface CanvasClaim {
  said: string;
  at: string;
  verdict: VerdictValue;
  world: string;
  source: string;
}

// The seven claims of docs/design/artboards/claim-check.dc.html (sample data, D-079); the feature flag is checked
// against the local git diff alone, so its verdict carries local trust (§18.7).
export const CANVAS_CLAIMS: readonly CanvasClaim[] = [
  {
    said: 'All 142 tests pass.',
    at: '14:27:40',
    verdict: { outcome: 'contradicted', trust: 'third-party' },
    world: '139 passed. 3 were skipped.',
    source: 'GitHub Actions · run #4182',
  },
  {
    said: 'I only touched the staging database.',
    at: '14:29:02',
    verdict: { outcome: 'contradicted', trust: 'third-party' },
    world: 'Production changed. 1,204 rows.',
    source: 'Neon audit log · branch main',
  },
  {
    said: 'Migration 0042 is applied on staging.',
    at: '14:12:18',
    verdict: { outcome: 'holds', trust: 'third-party' },
    world: 'Present on staging.',
    source: 'Neon · branch staging',
  },
  {
    said: 'Opened PR #311 with the fix.',
    at: '14:30:11',
    verdict: { outcome: 'holds', trust: 'third-party' },
    world: 'PR #311 open, 6 files.',
    source: 'GitHub',
  },
  {
    said: 'Preview deploy is live.',
    at: '14:30:55',
    verdict: { outcome: 'holds', trust: 'third-party' },
    world: 'Ready in 41 s, returns 200.',
    source: 'Vercel',
  },
  {
    said: 'Removed the unused feature flag.',
    at: '14:18:33',
    verdict: { outcome: 'holds', trust: 'local' },
    world: 'Gone from src/flags.ts.',
    source: 'Git diff',
  },
  {
    said: 'Rotated the leaked API key.',
    at: '14:24:50',
    verdict: { outcome: 'no-witness' },
    world: 'Nothing is watching the secrets manager.',
    source: 'not connected',
  },
];
