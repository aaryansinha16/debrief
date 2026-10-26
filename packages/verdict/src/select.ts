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

// The first HEAD the local git witness recorded is the base the session started from; later HEADs are its commits.
export function contextOf(events: readonly Event[], window: Window): Context {
  const observed = observedIn(events, window);
  const states = observed.filter(isLocalGitState);
  const shas = states.map((event) => str(event.attrs, 'commit.sha'));
  const baseCommit = shas.find((sha) => sha !== undefined);
  const commits = new Set<string>();
  for (const sha of shas) if (sha !== undefined && sha !== baseCommit) commits.add(sha);
  const latest = shas.filter((sha) => sha !== undefined).at(-1);
  const editedPaths = new Set<string>();
  for (const event of states) {
    for (const path of diffstatPaths(event)) if (path !== '') editedPaths.add(path);
  }
  return {
    observed,
    witnessed: states.length > 0,
    baseCommit,
    latestCommit: latest !== undefined && latest !== baseCommit ? latest : undefined,
    commits,
    editedPaths,
  };
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

// One workflow run may be retried; only its last attempt speaks for it, whatever each attempt reported.
export function latestAttempts(events: readonly Event[]): Event[] {
  const best = new Map<number, number>();
  for (const event of events) {
    const runId = num(event.attrs, 'github.run_id');
    const attempt = num(event.attrs, 'github.run_attempt') ?? 0;
    if (runId !== undefined) best.set(runId, Math.max(best.get(runId) ?? 0, attempt));
  }
  return events.filter((event) => {
    const runId = num(event.attrs, 'github.run_id');
    return runId === undefined || (num(event.attrs, 'github.run_attempt') ?? 0) === best.get(runId);
  });
}

export const onLatestCommit = (events: readonly Event[], ctx: Context): Event[] =>
  events.filter((event) => str(event.attrs, 'commit.sha') === ctx.latestCommit);

export const isHuman = (event: Event): boolean => event.actor.type === 'human';

export const tokenIn = (name: string, text: string): boolean =>
  new RegExp(
    `(?:^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`,
    'i',
  ).test(text);
