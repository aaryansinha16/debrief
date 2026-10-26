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
