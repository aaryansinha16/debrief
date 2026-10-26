import { type Attrs, type Event, sortTimeline } from '@debrief/schema';

import type { Context, Window } from './types.js';

export const str = (attrs: Attrs, key: string): string | undefined => {
  const value = attrs[key];
  return typeof value === 'string' ? value : undefined;
};

export const num = (attrs: Attrs, key: string): number | undefined => {
  const value = attrs[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

export const op = (event: Event): string => event.target?.operation ?? '';

export const summaryOf = (event: Event): string => event.summary ?? '';

export const short = (sha: string): string => sha.slice(0, 7);

// Witnesses report in their own clocks; the window is compared on the instant, not the string.
export function inWindow(event: Event, window: Window): boolean {
  const at = Date.parse(event.sourceTs);
  return at >= Date.parse(window.from) && at <= Date.parse(window.to);
}

export function observedIn(events: readonly Event[], window: Window): Event[] {
  const seen = new Set<string>();
  return sortTimeline(events).filter((event) => {
    if (event.provenance !== 'observed' || seen.has(event.id) || !inWindow(event, window)) {
      return false;
    }
    seen.add(event.id);
    return true;
  });
}

export const isLocalGitState = (event: Event): boolean =>
  event.target?.system === 'git' && op(event) === 'git.state';

export function diffstatPaths(event: Event): string[] {
  const stat = str(event.attrs, 'git.diffstat') ?? '';
  return stat === '' ? [] : stat.split('\n').map((line) => line.split('\t')[2] ?? '');
}

export interface DiffLine {
  path: string;
  added: number | null;
  removed: number | null;
}

export function diffstatLines(event: Event): DiffLine[] {
  const stat = str(event.attrs, 'git.diffstat') ?? '';
  if (stat === '') return [];
  return stat.split('\n').map((line) => {
    const [added = '', removed = '', ...rest] = line.split('\t');
    const count = (text: string): number | null => (/^\d+$/.test(text) ? Number(text) : null);
    return { path: rest.join('\t'), added: count(added), removed: count(removed) };
  });
}

// The session's commits come from the local git witness: context that binds CI evidence, never evidence itself.
export function contextOf(events: readonly Event[], window: Window): Context {
  const observed = observedIn(events, window);
  const commits = new Set<string>();
  const editedPaths = new Set<string>();
  for (const event of observed.filter(isLocalGitState)) {
    const sha = str(event.attrs, 'commit.sha');
    if (sha !== undefined) commits.add(sha);
    for (const path of diffstatPaths(event)) if (path !== '') editedPaths.add(path);
  }
  return { observed, commits, editedPaths };
}

export const thirdPartyOnly = (ctx: Context): Context => ({
  ...ctx,
  observed: ctx.observed.filter((event) => event.attrs['witness.trust'] === 'third-party'),
});

export const onSessionCommits = (events: readonly Event[], ctx: Context): Event[] =>
  events.filter((event) => {
    const sha = str(event.attrs, 'commit.sha');
    return sha !== undefined && ctx.commits.has(sha);
  });

// One workflow run may be retried; only its last attempt speaks for it.
export function latestAttempts(events: readonly Event[]): Event[] {
  const best = new Map<string, { attempt: number; events: Event[] }>();
  for (const event of events) {
    const runId = num(event.attrs, 'github.run_id');
    const attempt = num(event.attrs, 'github.run_attempt') ?? 0;
    const key = runId === undefined ? event.id : `${String(runId)}:${op(event)}`;
    const current = best.get(key);
    if (current === undefined || attempt > current.attempt) {
      best.set(key, { attempt, events: [event] });
    } else if (attempt === current.attempt) {
      current.events.push(event);
    }
  }
  return [...best.values()].flatMap((entry) => entry.events);
}

export const commitsText = (ctx: Context): string => [...ctx.commits].map(short).join(', ');
