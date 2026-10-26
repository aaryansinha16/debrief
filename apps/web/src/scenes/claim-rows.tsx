import { ClaimBeam } from '../components/claim-beam';
import { VERDICT_LOOK, Verdict, verdictValueOf } from '../components/verdict';
import { clockAt, offsetOf } from '../lib/check-copy';
import { PROVENANCE_TONE } from '../lib/provenance';
import type { ClaimView, EvidenceView, SessionCheck } from '../lib/session-check';
import { systemLabel } from '../lib/systems';

// The ring draws in first (globals.css); the beams light after it, the rows that hold 0.6 s apart.
const BEAM_START_S = 1.2;
const BEAM_STAGGER_S = 0.6;

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

function World({ claim, offset }: { claim: ClaimView; offset: number }) {
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
            no witness · {label} {claim.witness === 'missing' ? 'not connected' : 'connected'}
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
        <World claim={claim} offset={offset} />
      </div>
    </li>
  );
}

// claim-check.dc.html's panel: every claim, its check and what the world recorded, contradictions first.
export function ClaimList({ check }: { check: SessionCheck }) {
  const offset = offsetOf(check.session.startedAt);
  const holding = check.claims.filter((claim) => claim.state === 'holds').map((claim) => claim.id);
  return (
    <section
      aria-labelledby="claims-heading"
      className="panel mt-14 overflow-hidden rounded-panel shadow-panel"
    >
      <h2 id="claims-heading" className="sr-only">
        Claims checked
      </h2>
      <div
        className="hidden gap-5 border-b border-line px-[30px] py-4 font-mono text-[11px] tracking-[0.1em] text-label uppercase md:flex"
        aria-hidden="true"
      >
        <span className="flex-[1_1_300px]">The agent said</span>
        <span className="flex-[0_0_15.5rem]">The check</span>
        <span className="flex-[1_1_320px]">The world recorded</span>
      </div>
      <ol>
        {check.claims.map((claim) => {
          const turn = Math.max(0, holding.indexOf(claim.id));
          const delay = Math.round((BEAM_START_S + turn * BEAM_STAGGER_S) * 10) / 10;
          return <ClaimRow key={claim.id} claim={claim} delay={delay} offset={offset} />;
        })}
      </ol>
    </section>
  );
}
