import { PlayIcon } from '../components/controls';
import { IntegrityRing } from '../components/integrity-ring';
import { UnbuiltButton } from '../components/unbuilt-button';
import { type HeadlineTone, headlineOf, leadOf, sessionLine } from '../lib/check-copy';
import type { SessionCheck } from '../lib/session-check';
import { ClaimList } from './claim-rows';

const TONE: Record<HeadlineTone, string> = {
  contradicted:
    'text-contradicted [text-shadow:0_0_40px_color-mix(in_srgb,var(--color-contradicted)_55%,transparent)]',
  holds: 'text-holds [text-shadow:0_0_40px_color-mix(in_srgb,var(--color-holds)_45%,transparent)]',
  muted: 'text-text-muted',
};

// claim-check.dc.html's hero: the verdict worded from the counts, beside the integrity ring.
export function CheckHero({ check }: { check: SessionCheck }) {
  const headline = headlineOf(check.counts);
  return (
    <section
      aria-labelledby="check-headline"
      className="flex flex-wrap items-center justify-between gap-12"
      data-testid="check-hero"
    >
      <div className="min-w-0 flex-[1_1_560px]">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[12px] tracking-[0.08em] text-label uppercase">
          <span>{sessionLine(check.session)}</span>
          {check.session.sample ? (
            <span
              className="rounded-pill border border-line-strong px-2 py-0.5 text-text-muted"
              data-testid="sample"
            >
              Sample · fixture data
            </span>
          ) : null}
        </p>
        <h1
          id="check-headline"
          className="mt-[18px] font-display text-[clamp(52px,8.4vw,92px)] leading-[0.95] font-normal tracking-[-0.02em]"
        >
          {headline.claims}
          <br />
          <span className={`italic ${TONE[headline.tone]}`}>{headline.verdict}</span>
        </h1>
        <p className="mt-[22px] max-w-[560px] text-[18px] text-text-muted">{leadOf(check)}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <UnbuiltButton reason="check-soon" icon={<PlayIcon />}>
            Watch what happened
          </UnbuiltButton>
          <UnbuiltButton reason="check-soon">Seal &amp; share receipt</UnbuiltButton>
        </div>
        <p id="check-soon" className="mt-3 text-[13px] text-text-subtle">
          The replay and the shareable receipt are not built yet.
        </p>
      </div>
      <div className="mx-auto w-[min(360px,100%)] flex-none">
        <IntegrityRing arcs={check.ring} counts={check.counts} />
      </div>
    </section>
  );
}

export function ClaimCheck({ check }: { check: SessionCheck }) {
  return (
    <div className="pt-4 pb-10" data-testid="claim-check">
      <CheckHero check={check} />
      <ClaimList check={check} />
    </div>
  );
}
