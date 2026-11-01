import { TYPE } from '@debrief/ui';
import Link from 'next/link';

import { formatTime, shortId } from '../lib/format';
import type { SessionSummary } from '../lib/session-api';

export function SessionList({ sessions }: { sessions: readonly SessionSummary[] }) {
  if (sessions.length === 0) {
    return (
      <p className="text-text-muted" data-testid="empty">
        No sessions yet. Install the Stop hook with{' '}
        <code className="font-mono">debrief claude-code install</code> and finish a turn.
      </p>
    );
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="session-list">
      {sessions.map((session) => (
        <li key={session.id} data-session-id={session.id}>
          <Link
            href={`/sessions/${encodeURIComponent(session.id)}`}
            className="panel flex h-full flex-col gap-3 rounded-lg p-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className={TYPE.title} title={session.id}>
                {shortId(session.id)}
              </span>
              <span className={`${TYPE.mono} text-text-muted`}>
                {session.checkedAt === undefined ? 'not checked' : 'checked'}
              </span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className={TYPE.label}>started</dt>
              <dd className={TYPE.id}>{formatTime(session.startedAt)}</dd>
              <dt className={TYPE.label}>last message</dt>
              <dd className={TYPE.id}>{formatTime(session.lastMessageAt)}</dd>
            </dl>
            <div className="mt-auto flex items-baseline justify-between gap-3">
              <span className={TYPE.meta}>
                <span className="font-mono text-text">{session.messages}</span> messages ·{' '}
                <span className="font-mono text-text">{session.claims}</span> claims ·{' '}
                <span className="font-mono text-text">{session.verdicts}</span> verdicts
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
