import type { SessionCheck, WitnessView } from '../lib/session-check';
import { systemLabel } from '../lib/systems';

const events = (n: number): string =>
  n === 1 ? '1 event observed' : `${String(n)} events observed`;

function Witness({ witness }: { witness: WitnessView }) {
  const connected = witness.state === 'connected';
  return (
    <li
      className={`flex items-center gap-3 rounded-card border bg-surface px-5 py-[18px] ${
        connected ? 'border-line' : 'border-dashed border-line-strong'
      }`}
      data-state={witness.state}
      data-trust={connected ? witness.trust : undefined}
    >
      <span
        className={`h-2.5 w-2.5 flex-none rounded-full ${connected ? 'bg-holds shadow-glow-holds' : 'bg-no-witness'}`}
        aria-hidden="true"
      />
      <span className="flex min-w-0 flex-col">
        <span className="font-semibold">{systemLabel(witness.system)}</span>
        <span className="text-[13px] text-text-subtle">
          {connected ? events(witness.observed) : 'Not connected'}
        </span>
        {connected ? (
          <span className="font-mono text-[11px] tracking-[0.1em] text-label uppercase">
            {witness.trust}
          </span>
        ) : null}
      </span>
    </li>
  );
}

// ARCHITECTURE §18.6: the witnesses connected, with their trust, and the ones missing.
export function Witnesses({ check }: { check: SessionCheck }) {
  const connected = check.witnesses.filter((witness) => witness.state === 'connected').length;
  const missing = check.witnesses.length - connected;
  return (
    <section aria-labelledby="witnesses-heading" className="mt-7">
      <h2
        id="witnesses-heading"
        className="mb-3.5 font-mono text-[11px] tracking-[0.1em] text-label uppercase"
      >
        Witnesses · {connected} connected · {missing} missing
      </h2>
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5">
        {check.witnesses.map((witness) => (
          <Witness key={witness.system} witness={witness} />
        ))}
      </ul>
    </section>
  );
}
