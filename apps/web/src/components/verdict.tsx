import type { VerdictOutcome, WitnessTrust } from '@debrief/schema';
import { COLORS } from '@debrief/ui';

export interface VerdictLook {
  word: string;
  text: string;
  color: string;
}

// Every verdict is an icon, a word and a colour, never colour alone (docs/design/README.md).
export const VERDICT_LOOK: Record<VerdictOutcome, VerdictLook> = {
  holds: { word: 'Holds', text: 'text-holds', color: COLORS.holds },
  contradicted: { word: 'Contradicted', text: 'text-contradicted', color: COLORS.contradicted },
  'no-witness': { word: 'No witness', text: 'text-text-subtle', color: COLORS.noWitness },
};

// The beam's end node from claim-check.dc.html: a lit disc with a check or a cross, or a dashed ring around "?".
export function VerdictIcon({ outcome }: { outcome: VerdictOutcome }) {
  if (outcome === 'no-witness') {
    return (
      <span
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-no-witness font-mono text-[11px] leading-none text-text-muted"
        aria-hidden="true"
        data-testid="verdict-icon"
      >
        ?
      </span>
    );
  }
  const holds = outcome === 'holds';
  return (
    <span
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
        holds
          ? 'bg-holds shadow-[0_0_18px_var(--color-holds)]'
          : 'bg-contradicted shadow-[0_0_20px_var(--color-contradicted)]'
      }`}
      aria-hidden="true"
      data-testid="verdict-icon"
    >
      <svg
        width={holds ? 11 : 10}
        height={holds ? 11 : 10}
        viewBox="0 0 24 24"
        fill="none"
        stroke={COLORS.ground}
        strokeWidth={holds ? 3.4 : 3.6}
      >
        <path d={holds ? 'M5 12.5l4.5 4.5L19 7.5' : 'M6 6l12 12M18 6L6 18'} />
      </svg>
    </span>
  );
}

export interface VerdictProps {
  outcome: VerdictOutcome;
  trust?: WitnessTrust;
  className?: string;
}

// One verdict: icon, word, colour; a verdict that only local evidence backs says so (ARCHITECTURE §18.7).
export function Verdict({ outcome, trust, className = '' }: VerdictProps) {
  const look = VERDICT_LOOK[outcome];
  const local = outcome !== 'no-witness' && trust === 'local';
  return (
    <span
      className={`inline-flex items-center gap-2 font-mono text-[11px] leading-none tracking-[0.1em] uppercase ${className}`}
      data-testid="verdict"
      data-outcome={outcome}
      data-trust={outcome === 'no-witness' ? 'none' : (trust ?? 'none')}
    >
      <VerdictIcon outcome={outcome} />
      <span className={look.text}>{look.word}</span>
      {local ? (
        <span
          className="rounded-pill border border-line-strong px-1.5 py-0.5 text-[10px] text-text-muted"
          data-testid="verdict-local"
        >
          local<span className="sr-only">: backed only by evidence from this machine</span>
        </span>
      ) : null}
    </span>
  );
}
