import { ringLabel } from '../lib/check-copy';
import type { CheckCounts, RingArc } from '../lib/session-check';
import { VERDICT_LOOK, VerdictIcon } from './verdict';

const SIZE = 320;
const RADIUS = 128;
const STROKE = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// Round caps reach STROKE / 2 past each end; this leaves a visible gap of 6 between neighbouring arcs.
const INSET = STROKE / 2 + 3;
const ARC_STAGGER_S = 0.09;

const round = (n: number): number => Math.round(n * 100) / 100;

const pointAt = (length: number): string => {
  const angle = (length / CIRCUMFERENCE) * 2 * Math.PI;
  const x = SIZE / 2 + RADIUS * Math.sin(angle);
  const y = SIZE / 2 - RADIUS * Math.cos(angle);
  return `${String(round(x))} ${String(round(y))}`;
};

// An arc of the ring from `from` to `to` (fractions, clockwise from the top), drawn shorter so caps never touch.
export function arcPath(from: number, to: number): string {
  const span = (to - from) * CIRCUMFERENCE;
  const inset = Math.min(INSET, span / 4);
  const start = from * CIRCUMFERENCE + inset;
  const end = to * CIRCUMFERENCE - inset;
  const large = end - start > CIRCUMFERENCE / 2 ? 1 : 0;
  return `M ${pointAt(start)} A ${String(RADIUS)} ${String(RADIUS)} 0 ${String(large)} 1 ${pointAt(end)}`;
}

export interface IntegrityRingProps {
  arcs: readonly RingArc[];
  counts: CheckCounts;
}

// The canvas ring: one glowing arc per claim, coloured by verdict, no-witness arcs dashed, `holds / total` inside.
export function IntegrityRing({ arcs, counts }: IntegrityRingProps) {
  return (
    <figure className="m-0 flex flex-col items-center gap-5" data-testid="integrity-ring">
      <div className="relative aspect-square w-[min(320px,100%)]">
        <svg
          viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`}
          className="h-full w-full"
          role="img"
          aria-label={ringLabel(counts)}
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={STROKE}
          />
          {arcs.map((arc, index) => {
            const dashed = arc.outcome === 'no-witness';
            const color = VERDICT_LOOK[arc.outcome].color;
            return (
              <path
                key={arc.claimId}
                d={arcPath(arc.from, arc.to)}
                fill="none"
                stroke="currentColor"
                strokeWidth={STROKE}
                strokeLinecap={dashed ? 'butt' : 'round'}
                pathLength={dashed ? undefined : 1}
                className={dashed ? 'ring-arc-dashed' : 'ring-arc'}
                style={{ color, animationDelay: `${String(round(index * ARC_STAGGER_S))}s` }}
                data-outcome={arc.outcome}
                data-local={arc.local ? 'true' : undefined}
              />
            );
          })}
        </svg>
        <div
          className="absolute inset-0 flex flex-col items-center justify-center text-center"
          aria-hidden="true"
        >
          <span className="font-display text-[84px] leading-[0.9]">
            {counts.holds}
            <span className="text-label">/{counts.claims}</span>
          </span>
          <span className="mt-2 font-mono text-[12px] tracking-[0.1em] text-text-muted uppercase">
            {counts.holds === 1 ? 'claim holds' : 'claims hold'}
          </span>
        </div>
      </div>
      <figcaption>
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-2 font-mono text-[11px] tracking-[0.1em] text-text-muted uppercase">
          <Count outcome="holds" n={counts.holds} word={counts.holds === 1 ? 'holds' : 'hold'} />
          <Count outcome="contradicted" n={counts.contradicted} word="contradicted" />
          <Count outcome="no-witness" n={counts.noWitness} word="no witness" />
          {counts.local === 0 ? null : (
            <li className="rounded-pill border border-line-strong px-2 py-0.5 text-[10px]">
              {counts.local} on local evidence only
            </li>
          )}
        </ul>
      </figcaption>
    </figure>
  );
}

function Count({ outcome, n, word }: { outcome: RingArc['outcome']; n: number; word: string }) {
  return (
    <li className="inline-flex items-center gap-2">
      <VerdictIcon outcome={outcome} />
      <span>
        {n} {word}
      </span>
    </li>
  );
}
