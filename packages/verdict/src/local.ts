import type { ClaimRecord } from './types.js';

const RUNNERS = [
  'pnpm',
  'npm',
  'npx',
  'yarn',
  'bun',
  'deno',
  'turbo',
  'nx',
  'vitest',
  'jest',
  'mocha',
  'playwright',
  'cypress',
  'eslint',
  'prettier',
  'tsc',
  'pytest',
  'tox',
  'uv',
  'cargo',
  'gradle',
  'mvn',
];
// Tools that run on the agent's machine: what they printed there is no CI run's to confirm.
const LOCAL_SYSTEMS = new Set(['local', 'shell', 'terminal', 'node', 'make', ...RUNNERS]);
const COMMAND = new RegExp(
  `(?:^|[\\s(:\`])(?:${RUNNERS.join('|')})\\s+(?:--?[a-z]|[a-z][\\w:-]*\\b)|\`(?:make\\s+[a-z][\\w-]*|node\\s+(?:--?[a-z]|[\\w./-]+\\.[cm]?[jt]s\\b))[^\`]*\``,
  'i',
);
const LOCAL_PHRASE =
  /\blocally\b|\blocal (?:run|checkout|machine|build)\b|\bon (?:my|this) (?:machine|laptop|computer)\b|\bin (?:the|my) terminal\b|\bin (?:my|the|this) (?:worktree|checkout|working copy)\b/i;
const I_RAN = /\bI\s+(?:ran|re-?ran|executed|invoked)\b/i;
// CI as the one that ran or reported the result, not CI named for comparison ("same as CI", "CI-style").
const CI_DID =
  /\b(?:CI|GitHub Actions|the (?:workflow|pipeline)|(?:the )?CI (?:run|job|build|pipeline|workflow)|run #?\d+)(?:'s)?\s+(?:(?!(?:I|we|you)\b)[\w-]+\s+){0,3}?(?:ran|runs|executed|re-?ran|shows?|showed|reports?|reported|passed|passes|succeeded|is (?:green|passing)|was green|went green|stays green)\b|\b(?:in|on|from|via|by) (?:CI|GitHub Actions)\b(?!\s*(?:terms|config|style|-))/i;

const where = (claim: ClaimRecord): unknown => claim.params.where;

export const ciAttributed = (claim: ClaimRecord): boolean =>
  where(claim) === 'ci' || (where(claim) !== 'local' && CI_DID.test(claim.text));

// The subject CI evidence is read for: a sentence that says CI ran it reads CI's record whatever tool the extractor named.
export const ciSubject = (claim: ClaimRecord): ClaimRecord =>
  ciAttributed(claim) ? { ...claim, subject: { ...claim.subject, system: 'ci' } } : claim;

// The agent's own run: the extractor or the sentence says so, or it names a tool it ran, unless CI ran it.
export function isLocalRun(claim: ClaimRecord): boolean {
  if (where(claim) === 'local') return true;
  if (where(claim) === 'ci') return false;
  if (LOCAL_PHRASE.test(claim.text)) return true;
  if (CI_DID.test(claim.text)) return false;
  return (
    LOCAL_SYSTEMS.has(claim.subject.system.toLowerCase()) ||
    I_RAN.test(claim.text) ||
    COMMAND.test(claim.text)
  );
}
