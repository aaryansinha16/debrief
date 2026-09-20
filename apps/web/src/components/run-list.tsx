import type { Run } from '@debrief/schema';
import Link from 'next/link';

import { formatDuration, formatTime, shortId } from '../lib/format';

const riskClass: Record<NonNullable<Run['riskMax']>, string> = {
  low: 'text-text-muted',
  medium: 'text-cyan',
  high: 'text-ember',
  critical: 'text-ember font-semibold',
};

export function RunList({ runs }: { runs: readonly Run[] }) {
  if (runs.length === 0) {
    return (
      <p className="text-text-muted" data-testid="empty">
        No runs yet. Run <code className="font-mono">pnpm demo:nine-seconds</code> and refresh.
      </p>
    );
  }
  return (
    <table className="w-full text-sm" data-testid="run-list">
      <thead className="text-left text-[11px] font-medium tracking-[0.18em] uppercase text-text-muted">
        <tr>
          <th className="py-2 pr-4 font-normal">Run</th>
          <th className="py-2 pr-4 font-normal">Agent</th>
          <th className="py-2 pr-4 font-normal">Principal</th>
          <th className="py-2 pr-4 font-normal">Started</th>
          <th className="py-2 pr-4 font-normal">Duration</th>
          <th className="py-2 pr-4 text-right font-normal">Events</th>
          <th className="py-2 pr-4 font-normal">Risk</th>
          <th className="py-2 font-normal">Divergences</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr
            key={run.id}
            className="border-t border-stage-edge transition-colors hover:bg-stage-raised"
            data-run-id={run.id}
          >
            <td className="py-3 pr-4 font-mono">
              <Link
                href={`/runs/${encodeURIComponent(run.id)}`}
                className="text-cyan hover:underline"
              >
                {shortId(run.id)}
              </Link>
            </td>
            <td className="py-3 pr-4">{run.agentName}</td>
            <td className="py-3 pr-4 font-mono text-text-muted">{run.principalId}</td>
            <td className="py-3 pr-4 font-mono text-text-muted">{formatTime(run.startedAt)}</td>
            <td className="py-3 pr-4 text-text-muted">
              {formatDuration(run.startedAt, run.endedAt)}
            </td>
            <td className="py-3 pr-4 text-right font-mono">{run.eventCount}</td>
            <td
              className={`py-3 pr-4 ${run.riskMax === undefined ? 'text-text-muted' : riskClass[run.riskMax]}`}
            >
              {run.riskMax ?? '—'}
            </td>
            <td className="py-3">{run.divergenceCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
