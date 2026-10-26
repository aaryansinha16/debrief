import { type Attrs, type Event, sortTimeline } from '@debrief/schema';

import type { ClaimRecord, Context, Window } from './types.js';

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
export function contextOf(
  events: readonly Event[],
  window: Window,
  sessions?: ReadonlySet<string>,
): Context {
  const observed = observedIn(events, window);
  const states = observed.filter(
    (event) => isLocalGitState(event) && (sessions === undefined || sessions.has(event.runId)),
  );
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

// A subject the extractor could not pin down, or named loosely, still reads its system's own witnesses.
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  github: ['github', 'github-actions', 'actions', 'ci', 'git', 'unknown'],
  git: ['git', 'repo', 'repository', 'local', 'working-copy', 'unknown'],
};

export const onSubject = (claim: ClaimRecord, events: readonly Event[]): Event[] =>
  events.filter((event) => {
    const system = event.target?.system ?? '';
    return (
      system === claim.subject.system || (ALIASES[system] ?? []).includes(claim.subject.system)
    );
  });

// "API key", `api-key` and `billing/api-key` name the same thing: tokens split on anything but letters and digits.
const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

export const tokenIn = (name: string, text: string): boolean => {
  const want = tokens(name);
  const have = tokens(text);
  if (want.length === 0) return false;
  return have.some((_, at) => want.every((token, n) => have[at + n] === token));
};
