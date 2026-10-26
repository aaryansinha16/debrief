import { UnbuiltButton } from '../components/unbuilt-button';
import { clockAt } from '../lib/check-copy';
import { PROVENANCE_TONE } from '../lib/provenance';
import type { SideEffectView } from '../lib/session-check';
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

// ARCHITECTURE §18.5: a change linked to the agent's tool calls that no claim covers.
export function SideEffectCard({ effect, offset }: { effect: SideEffectView; offset: number }) {
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
      <div className="flex flex-col items-start gap-2">
        <UnbuiltButton reason={`moment-soon-${effect.world.id}`}>Show me the moment</UnbuiltButton>
        <p id={`moment-soon-${effect.world.id}`} className="text-[13px] text-text-subtle">
          The replay is not built yet.
        </p>
      </div>
    </article>
  );
}
