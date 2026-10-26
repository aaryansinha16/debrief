import { COLORS } from '@debrief/ui';

import type { ClaimState } from '../lib/session-check';

const START: Record<ClaimState, string> = {
  holds: 'border-holds',
  contradicted: 'border-contradicted',
  'no-witness': 'border-no-witness',
  pending: 'border-line-strong',
  hedged: 'border-line-strong',
};

const LINE = 'absolute top-[19px] right-0 left-1.5';

export interface ClaimBeamProps {
  state: ClaimState;
  // Seconds before the first pulse, so the rows that hold light up one after another.
  delay?: number;
}

// claim-check.dc.html: the beam from what was said to the verdict. Light travels along a claim that holds, the
// line fractures and flickers on a contradicted one, and it is dotted where no witness saw. CSS only; the
// verdict's icon is the node at its end.
export function ClaimBeam({ state, delay = 0 }: ClaimBeamProps) {
  return (
    <span className="relative block h-10 min-w-12 flex-1" aria-hidden="true" data-beam={state}>
      {state === 'holds' ? (
        <span className={`${LINE} h-0.5 bg-holds shadow-glow-holds`}>
          <span className="beam-run" style={{ animationDelay: `${String(delay)}s` }}>
            <span className="beam-pulse" />
          </span>
        </span>
      ) : state === 'contradicted' ? (
        <span className="absolute inset-y-0 right-0 left-1.5 flex items-center">
          <span className="h-0.5 flex-1 bg-contradicted shadow-glow-contradicted" />
          <svg
            className="beam-fracture shrink-0"
            width="56"
            height="40"
            viewBox="0 0 56 40"
            fill="none"
          >
            <path
              d="M2 20l10-9 6 14 9-17 7 18 8-10 12 4"
              stroke={COLORS.contradicted}
              strokeWidth="2.2"
              strokeLinejoin="round"
            />
          </svg>
          <span className="h-0.5 flex-1 bg-contradicted/40" />
        </span>
      ) : (
        <span
          className={`${LINE} border-t-2 border-dotted ${state === 'no-witness' ? 'border-no-witness' : 'border-line-strong'}`}
        />
      )}
      <span
        className={`absolute top-[14px] left-0 h-3 w-3 rounded-full border-2 bg-ground ${START[state]}`}
      />
    </span>
  );
}
