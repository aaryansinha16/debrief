import { ClaimBeam } from '../components/claim-beam';
import { VERDICT_LOOK, Verdict, verdictValueOf } from '../components/verdict';
import { clockAt } from '../lib/check-copy';
import { PROVENANCE_TONE } from '../lib/provenance';
import type { ClaimView, EvidenceView } from '../lib/session-check';
import { systemLabel } from '../lib/systems';

const META = 'font-mono text-[12px] text-label';
const DERIVED = PROVENANCE_TONE.derived.glyph;
const OBSERVED = PROVENANCE_TONE.observed.glyph;

function Evidence({ event, offset, tone }: { event: EvidenceView; offset: number; tone: string }) {
  const where = [systemLabel(event.target?.system ?? 'unknown'), event.target?.resource];
  return (
    <div data-testid="evidence">
      <p className={`text-[17px] leading-snug font-semibold ${tone}`}>
        {event.summary ?? event.kind}
      </p>
      <p className={`mt-1 [overflow-wrap:anywhere] ${META}`}>
        {OBSERVED} observed · {where.filter(Boolean).join(' · ')} · {clockAt(event.at, offset)}
        {event.trust === 'local' ? ' · local' : ''}
      </p>
    </div>
  );
}

// What the world recorded about a claim, labelled observed, and Debrief's reading of it, labelled derived.
export function ClaimWorld({ claim, offset }: { claim: ClaimView; offset: number }) {
  const { verdict } = claim;
  const label = systemLabel(claim.subject.system);
  if (claim.state === 'hedged' || verdict === undefined) {
    return (
      <p className="text-[17px] font-semibold text-text-muted">
        {claim.state === 'hedged' ? 'Hedged, so never scored.' : 'Not checked yet.'}
      </p>
    );
  }
  const tone = claim.state === 'contradicted' ? 'text-contradicted' : 'text-text';
  return (
    <>
      {verdict.evidence.map((event) => (
        <Evidence key={event.id} event={event} offset={offset} tone={tone} />
      ))}
      {verdict.evidence.length === 0 ? (
        <>
          <p className="text-[17px] font-semibold text-text-muted">
            {claim.witness === 'missing' ? `${label} is not connected.` : 'No record settles it.'}
          </p>
          <p className={`mt-1 ${META}`}>
            {DERIVED} derived · no witness · {label}{' '}
            {claim.witness === 'missing' ? 'not connected' : 'connected'}
          </p>
        </>
      ) : null}
      <p className="mt-2 text-[14px] text-text-muted">
        <span className={META}>{DERIVED} derived · </span>
        {verdict.reason}
      </p>
    </>
  );
}

function Check({ claim, delay, offset }: { claim: ClaimView; delay: number; offset: number }) {
  const { verdict } = claim;
  const earlier = claim.history[0];
  const scored = claim.state !== 'hedged' && verdict !== undefined;
  return (
    <div className="flex flex-[1_1_100%] flex-col gap-1 md:flex-[0_0_15.5rem]">
      <div className="flex items-center">
        <ClaimBeam state={claim.state} delay={delay} />
        {scored ? (
          <Verdict {...verdictValueOf(verdict)} />
        ) : (
          <span className="font-mono text-[11px] tracking-[0.1em] text-text-subtle uppercase">
            {claim.state === 'hedged' ? 'Not scored' : 'Not checked'}
          </span>
        )}
      </div>
      {scored && earlier !== undefined ? (
        <p className="font-mono text-[11px] text-label">
          revised {clockAt(verdict.at, offset)} · was{' '}
          {VERDICT_LOOK[earlier.outcome].word.toLowerCase()}
        </p>
      ) : null}
    </div>
  );
}

export function ClaimRow({
  claim,
  delay,
  offset,
}: {
  claim: ClaimView;
  delay: number;
  offset: number;
}) {
  const quiet = claim.state !== 'holds' && claim.state !== 'contradicted';
  return (
    <li
      className={`flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line px-5 py-[22px] last:border-b-0 md:px-[30px] ${
        claim.state === 'contradicted' ? 'row-contradicted' : ''
      }`}
      data-state={claim.state}
    >
      <div className="min-w-0 flex-[1_1_300px]">
        <p
          className={`font-display text-[27px] leading-[1.15] ${quiet ? 'text-text-muted' : 'text-text'}`}
        >
          <span className="sr-only">The agent said: </span>“{claim.text}”
        </p>
        <p className={`mt-1.5 ${META}`}>
          {DERIVED} derived claim{claim.modality === 'hedged' ? ' · hedged' : ''} · said{' '}
          {clockAt(claim.saidAt, offset)}
        </p>
      </div>
      <Check claim={claim} delay={delay} offset={offset} />
      <div className="min-w-0 flex-[1_1_320px]">
        <span className="sr-only">The world recorded: </span>
        <ClaimWorld claim={claim} offset={offset} />
      </div>
    </li>
  );
}
