import type { Run } from '@debrief/schema';
import { TYPE } from '@debrief/ui';
import Link from 'next/link';

import { formatDuration, formatTime, shortId } from '../lib/format';

const riskClass: Record<NonNullable<Run['riskMax']>, string> = {
  low: 'text-text-muted',
  medium: 'text-cyan',
  high: 'text-ember',
  critical: 'text-ember font-semibold',
};

const riskGlow: Record<NonNullable<Run['riskMax']>, string> = {
  low: '',
  medium: 'hover:shadow-glow-cyan',
  high: 'hover:shadow-glow-ember',
  critical: 'shadow-glow-ember',
};

// One card per run: the risk is the first thing you see, the id the last.
export function RunList({ runs }: { runs: readonly Run[] }) {
  if (runs.length === 0) {
    return (
      <p className="text-text-muted" data-testid="empty">
        No runs yet. Run <code className="font-mono">pnpm demo:nine-seconds</code> and refresh.
      </p>
    );
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="run-list">
      {runs.map((run) => (
        <li key={run.id} data-run-id={run.id}>
          <Link
            href={`/runs/${encodeURIComponent(run.id)}`}
            className={`glass flex h-full flex-col gap-3 rounded-lg p-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 ${
              run.riskMax === undefined ? '' : riskGlow[run.riskMax]
            }`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className={TYPE.title}>{run.agentName}</span>
              <span
                className={`${TYPE.mono} ${run.riskMax === undefined ? 'text-text-muted' : riskClass[run.riskMax]}`}
              >
                {run.riskMax ?? 'no risk'}
              </span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className={TYPE.label}>for</dt>
              <dd className={TYPE.id}>{run.principalId}</dd>
              <dt className={TYPE.label}>started</dt>
              <dd className={TYPE.id}>{formatTime(run.startedAt)}</dd>
              <dt className={TYPE.label}>lasted</dt>
              <dd className={TYPE.body}>{formatDuration(run.startedAt, run.endedAt)}</dd>
            </dl>
            <div className="mt-auto flex items-baseline justify-between gap-3">
              <span className={TYPE.meta}>
                <span className="font-mono text-text">{run.eventCount}</span> events ·{' '}
                <span
                  className={`font-mono ${run.divergenceCount > 0 ? 'text-ember' : 'text-text'}`}
                >
                  {run.divergenceCount}
                </span>{' '}
                divergence{run.divergenceCount === 1 ? '' : 's'}
              </span>
              <span className={`${TYPE.mono} text-cyan`}>{shortId(run.id)} →</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
