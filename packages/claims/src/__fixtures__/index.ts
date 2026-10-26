import type { TranscriptMessage } from '../extract.js';
import type { Reply, ReplyClaim } from '../reply.js';

export interface FixtureSession {
  id: string;
  messages: TranscriptMessage[];
  reply: Reply;
}

const id = (n: number): string => `01JBCM000000000000000000${String(n).padStart(2, '0')}`;
const at = (time: string): string => `2026-10-25T${time}.000+05:30`;

const said = (n: number, time: string, text: string): TranscriptMessage => ({
  id: id(n),
  saidAt: at(time),
  text,
});

const claim = (
  n: number,
  quote: string,
  predicate: string,
  subject: Partial<ReplyClaim['subject']> & { system: string },
  params: Record<string, string> = {},
  modality: ReplyClaim['modality'] = 'asserted',
): ReplyClaim => ({
  message_id: id(n),
  quote,
  modality,
  predicate,
  subject: { resource: null, environment: null, operation: null, ...subject },
  params: Object.entries(params).map(([name, value]) => ({ name, value })),
});

// The canvas session (docs/design/artboards/claim-check.dc.html): seven claims, values invented (D-079).
export const canvasSession: FixtureSession = {
  id: 'session-canvas',
  messages: [
    said(1, '14:12:18', 'Migration 0042 is applied on staging. Next I will look at the flags.'),
    said(2, '14:18:33', 'Removed the unused feature flag. It was only read in src/flags.ts.'),
    said(3, '14:24:50', 'Rotated the leaked API key and updated the vault entry.'),
    said(4, '14:27:40', 'All 142 tests pass.'),
    said(5, '14:29:02', 'I only touched the staging database.'),
    said(6, '14:30:11', 'Opened PR #311 with the fix.'),
    said(7, '14:30:55', 'Preview deploy is live. The build should stay green, I think.'),
  ],
  reply: {
    claims: [
      claim(
        1,
        'Migration 0042 is applied on staging.',
        'migration.applied',
        {
          system: 'neon',
          environment: 'staging',
        },
        { name: '0042' },
      ),
      claim(2, 'Removed the unused feature flag.', 'code.removed', {
        system: 'git',
        resource: 'src/flags.ts',
      }),
      claim(3, 'Rotated the leaked API key', 'secret.rotated', { system: 'secrets' }),
      claim(4, 'All 142 tests pass.', 'tests.passed', { system: 'github' }, { passed: '142' }),
      claim(4, 'All 143 tests pass.', 'tests.passed', { system: 'github' }, { passed: '143' }),
      claim(
        5,
        'I only touched the staging database.',
        'db.scope',
        {
          system: 'neon',
          environment: 'staging',
        },
        { environment: 'staging' },
      ),
      claim(
        6,
        'Opened PR #311 with the fix.',
        'pr.opened',
        {
          system: 'github',
          resource: 'acme/billing-api',
        },
        { number: '311' },
      ),
      claim(
        7,
        'Preview deploy is live.',
        'deploy.ready',
        { system: 'vercel' },
        { target: 'preview' },
      ),
      claim(7, 'The build should stay green, I think.', 'ci.passed', { system: 'github' }),
      { ...claim(4, 'ship it', 'unchecked', { system: 'claude-code' }), message_id: 'user-1' },
    ],
  },
};
