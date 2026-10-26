import { clockAt, offsetOf } from '../lib/check-copy';
import { PROVENANCE_TONE } from '../lib/provenance';
import type { SessionCheck, SideEffectView } from '../lib/session-check';
import { systemLabel } from '../lib/systems';

const META = 'font-mono text-[12px] text-label [overflow-wrap:anywhere]';
const { derived, observed, reported } = PROVENANCE_TONE;

const sentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`);

function Trail({ effect, offset }: { effect: SideEffectView; offset: number }) {
  const { world, toolCall } = effect;
  const where = [systemLabel(world.target?.system ?? 'unknown'), world.target?.resource];
  return (
    <ul className="mt-3 flex flex-col gap-1">
      <li className={META}>
        {observed.glyph} observed · {where.filter(Boolean).join(' · ')} ·{' '}
        {clockAt(world.at, offset)}
      </li>
      <li className={META}>
        {reported.glyph} reported · tool call <code className="text-text">{toolCall.name}</code> ·{' '}
        {clockAt(toolCall.at, offset)}
      </li>
      <li className={META}>
        {derived.glyph} derived · linked{effect.via === undefined ? '' : ` by ${effect.via}`} ·
        confidence {effect.confidence}
      </li>
    </ul>
  );
}

// claim-check.dc.html: a change a witness linked to the agent's tool calls that no claim covers (ARCHITECTURE §18.5).
function Counted({ effect, offset }: { effect: SideEffectView; offset: number }) {
  const label = systemLabel(effect.world.target?.system ?? 'unknown');
  return (
    <article
      className="side-effect relative flex flex-wrap items-center justify-between gap-7 overflow-hidden rounded-panel border-[1.5px] border-dashed border-contradicted/70 p-6 md:p-8"
      data-testid="side-effect"
      data-confidence={effect.confidence}
    >
      <div className="min-w-0 flex-[1_1_560px]">
        <p className="font-mono text-[11px] tracking-[0.12em] text-contradicted uppercase">
          Seen by {label} · never mentioned by the agent
        </p>
        <h3 className="mt-3 font-display text-[clamp(32px,4vw,42px)] leading-[1.08] font-normal">
          {sentence(effect.world.summary ?? effect.world.kind)}{' '}
          <span className="italic">The agent didn’t say a word.</span>
        </h3>
        <Trail effect={effect} offset={offset} />
      </div>
      <button
        type="button"
        disabled
        aria-describedby="check-soon"
        className="inline-flex min-h-12 items-center rounded-pill bg-contradicted px-[22px] font-bold text-ground shadow-[0_0_40px_color-mix(in_srgb,var(--color-contradicted)_50%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Show me the moment
      </button>
    </article>
  );
}

export function SideEffects({ check }: { check: SessionCheck }) {
  const { counted, weak } = check.sideEffects;
  const offset = offsetOf(check.session.startedAt);
  return (
    <section aria-labelledby="effects-heading" className="mt-7 flex flex-col gap-4">
      <h2 id="effects-heading" className="sr-only">
        {counted.length === 1
          ? '1 unreported side effect'
          : `${String(counted.length)} unreported side effects`}
      </h2>
      {counted.map((effect) => (
        <Counted key={effect.world.id} effect={effect} offset={offset} />
      ))}
      {counted.length === 0 ? (
        <p
          className="rounded-card border border-line px-5 py-4 text-text-muted"
          data-testid="no-side-effects"
        >
          No unreported side effects: no witness linked a change to this session’s tool calls that a
          claim leaves out.
        </p>
      ) : null}
      {weak.length === 0 ? null : (
        <div
          className="rounded-card border border-dashed border-line-strong px-5 py-4"
          data-testid="weak-links"
        >
          <h3 className="font-mono text-[11px] tracking-[0.1em] text-label uppercase">
            Weak links · listed apart, never counted
          </h3>
          <ul className="mt-2 flex flex-col gap-3">
            {weak.map((effect) => (
              <li key={effect.world.id}>
                <p className="text-text-muted">
                  {sentence(effect.world.summary ?? effect.world.kind)}
                </p>
                <Trail effect={effect} offset={offset} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
