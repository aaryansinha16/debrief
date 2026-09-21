import type { Run } from '@debrief/schema';
import { TYPE } from '@debrief/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { formatDuration, formatTime, shortId } from '../lib/format';

export type RunView = 'theatre' | 'blast' | 'lineage' | 'branch' | 'evidence';

export const RUN_VIEWS: readonly { id: RunView; label: string; path: string }[] = [
  { id: 'theatre', label: 'Theatre', path: '' },
  { id: 'blast', label: 'Blast radius', path: '/blast' },
  { id: 'lineage', label: 'Authority lineage', path: '/lineage' },
  { id: 'branch', label: 'Branch', path: '/branch' },
  { id: 'evidence', label: 'Sealed file', path: '/evidence' },
];

export interface RunHeaderProps {
  run: Run;
  view: RunView;
  divergences?: number;
  policyId?: string;
  detail?: ReactNode;
}

const RISK: Record<NonNullable<Run['riskMax']>, string> = {
  low: 'text-text-muted',
  medium: 'text-cyan',
  high: 'text-ember',
  critical: 'text-ember',
};

// One header for every run page: the run's facts once, the views as tabs, the page's own detail line beneath.
export function RunHeader({
  run,
  view,
  divergences,
  policyId = 'prod-guard',
  detail,
}: RunHeaderProps) {
  const base = `/runs/${encodeURIComponent(run.id)}`;
  return (
    <header className="flex flex-col gap-4" data-testid="run-header">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className={TYPE.display}>
          <span className="text-text-muted">run</span> {shortId(run.id)}
        </h1>
        <span className={TYPE.mono} title={run.id} data-testid="run-id">
          {run.id}
        </span>
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-2" data-testid="run-facts">
        <Fact label="agent">{run.agentName}</Fact>
        <Fact label="for" mono>
          {run.principalId}
        </Fact>
        <Fact label="started" mono>
          {formatTime(run.startedAt)}
        </Fact>
        <Fact label="lasted">{formatDuration(run.startedAt, run.endedAt)}</Fact>
        <Fact label="events" mono>
          {String(run.eventCount)}
        </Fact>
        {run.riskMax === undefined ? null : (
          <Fact label="risk">
            <span className={RISK[run.riskMax]}>{run.riskMax}</span>
          </Fact>
        )}
        {divergences === undefined ? null : (
          <Fact label={`under ${policyId}`}>
            <span className={divergences > 0 ? 'text-ember' : 'text-text-muted'}>
              {String(divergences)} divergence{divergences === 1 ? '' : 's'}
            </span>
          </Fact>
        )}
      </dl>
      <nav className="flex gap-1 border-b border-edge-light" aria-label="run views">
        {RUN_VIEWS.map((entry) => {
          const current = entry.id === view;
          return (
            <Link
              key={entry.id}
              href={`${base}${entry.path}`}
              aria-current={current ? 'page' : undefined}
              className={`-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm transition-[color,border-color,background-color] duration-200 ${
                current
                  ? 'border-cyan text-text shadow-[0_12px_24px_-16px_var(--color-cyan)]'
                  : 'border-transparent text-text-muted hover:bg-stage-raised/50 hover:text-text'
              }`}
            >
              {entry.label}
            </Link>
          );
        })}
      </nav>
      {detail === undefined ? null : (
        <p className={TYPE.meta} data-testid="run-detail">
          {detail}
        </p>
      )}
    </header>
  );
}

function Fact({
  label,
  mono = false,
  children,
}: {
  label: string;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className={TYPE.label}>{label}</dt>
      <dd className={mono ? TYPE.id : TYPE.body}>{children}</dd>
    </div>
  );
}
