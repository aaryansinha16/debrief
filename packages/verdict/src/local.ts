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
  'go',
  'dotnet',
  'make',
];
// Tools that run on the agent's machine: what they printed there is no CI run's to confirm.
const LOCAL_SYSTEMS = new Set(['local', 'shell', 'terminal', 'node', ...RUNNERS]);
const QUOTED = new RegExp(
  `\`(?:cd\\s+\\S+\\s*&&\\s*)?(?:${RUNNERS.join('|')}|node\\s+(?:--?[a-z]|[\\w./-]+\\.[cm]?[jt]s\\b))[^\`]*\``,
  'i',
);
const UNQUOTED = new RegExp(
  `(?:^|[\\s(:])(?:${RUNNERS.join('|')})\\s+(?:--?[a-z]|(?:test|tests|run|lint|typecheck|check|exec|vitest|jest)\\b)`,
  'i',
);
const LOCAL_PHRASE =
  /\blocally\b|\blocal (?:run|checkout|machine)\b|\bon (?:my|this) (?:machine|laptop|computer|workstation|box|end)\b|\bin (?:the|my) terminal\b|\bin (?:my|the|this) (?:worktree|checkout|working copy|environment)\b|\bon localhost\b|\b(?:pass(?:es|ed)?|green|ran)\s+here\b|\bmyself\b|\bafter running\b/i;
// A sentence that measures itself against CI, or says CI has not run, reports another run.
const LOCAL_HINT =
  /\b(?:same as|like|matches|matching|per) (?:the )?CI\b|\bCI[- ](?:style|equivalent|mode|terms)\b|\bin CI (?:terms|mode)\b|\b(?:before|until|once|when|if|unless) CI\b|\bCI (?:will|would|should|has(?:n't| not)|did(?:n't| not)|is(?:n't| not)|is still|still)\b/i;
const I_RAN =
  /\b(?:I|we)(?:'ve| have)?\s+(?:just\s+|also\s+|then\s+|first\s+)?(?:ran|run|re-?ran|executed|invoked)\b(?!\s+into)/i;
// CI as the one that ran or reported the result.
const CI_DID =
  /\b(?:CI|GitHub Actions|the (?:workflow|pipeline)|(?:the )?CI (?:run|job|build|pipeline|workflow)|run #?\d+)(?:'s)?\s+(?:(?!(?:I|we|you|will|would|should|may|might|can|could|to)\b)[\w-]+\s+){0,3}?(?:ran|runs|executed|re-?ran|shows?|showed|reports?|reported|passed|passes|succeeded|is (?:green|passing)|was green|went green|stays green)\b|\b(?:in|on|via|by) (?:CI|GitHub Actions)\b/i;

const where = (claim: ClaimRecord): unknown => claim.params.where;

export const ciAttributed = (claim: ClaimRecord): boolean =>
  where(claim) === 'ci' || (where(claim) !== 'local' && CI_DID.test(claim.text));

// A sentence that says CI ran it reads CI's record when the extractor named a local tool or nothing; another CI system stays itself.
export const ciSubject = (claim: ClaimRecord): ClaimRecord => {
  const system = claim.subject.system.toLowerCase();
  return ciAttributed(claim) && (LOCAL_SYSTEMS.has(system) || system === 'unknown')
    ? { ...claim, subject: { ...claim.subject, system: 'ci' } }
    : claim;
};

// The agent's own run: the extractor or the sentence says so, or it names a tool it ran, unless CI ran it.
export function isLocalRun(claim: ClaimRecord): boolean {
  if (where(claim) === 'local') return true;
  if (where(claim) === 'ci') return false;
  if (LOCAL_PHRASE.test(claim.text) || LOCAL_HINT.test(claim.text)) return true;
  if (CI_DID.test(claim.text)) return false;
  return (
    LOCAL_SYSTEMS.has(claim.subject.system.toLowerCase()) ||
    I_RAN.test(claim.text) ||
    QUOTED.test(claim.text) ||
    UNQUOTED.test(claim.text)
  );
}
