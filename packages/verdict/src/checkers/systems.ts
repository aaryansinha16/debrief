import type { Event } from '@debrief/schema';

import { isHuman, onSessionCommits, op, str, summaryOf, tokenIn } from '../select.js';
import type { Checker, ClaimRecord, Context, Finding } from '../types.js';
import { NO_GIT, headStayed, noWitness } from './ci.js';

const system = (claim: ClaimRecord): string => claim.subject.system;

const onSystem = (claim: ClaimRecord, events: readonly Event[]): Event[] =>
  events.filter((e) => e.target?.system === system(claim));

const summaries = (events: readonly Event[]): string => events.map(summaryOf).join('; ');

const notWatched = (claim: ClaimRecord, what: string): Finding =>
  noWitness(`nothing is watching ${system(claim)}: connect a witness and ${what} get checked`);

const placed = (claim: ClaimRecord): string | undefined => {
  const environment = claim.subject.environment;
  return environment === undefined || environment === 'unknown' ? undefined : environment;
};

const named = (claim: ClaimRecord): string | undefined => {
  const name = claim.params.name;
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : undefined;
};

// A scope claim is contradicted by the session's own change elsewhere; it holds only with coverage no witness attests yet (§18.4).
export const dbScope: Checker = (claim, ctx): Finding => {
  const changes = onSystem(claim, ctx.observed).filter((e) => e.kind === 'world.change');
  if (changes.length === 0) return notWatched(claim, 'claims about its scope');
  const wanted =
    typeof claim.params.environment === 'string' ? claim.params.environment : placed(claim);
  if (wanted === undefined) return noWitness('the claim names no environment to hold it to');
  const elsewhere = changes.filter((e) => {
    const environment = e.target?.environment;
    return environment !== undefined && environment !== 'unknown' && environment !== wanted;
  });
  const outside = elsewhere.filter((e) => !isHuman(e));
  if (outside.length > 0) {
    return {
      outcome: 'contradicted',
      evidence: outside,
      reason: `${system(claim)} recorded a change outside ${wanted}: ${summaries(outside)}`,
    };
  }
  const humans = elsewhere.map((e) => `${e.actor.id} (human)`).join(', ');
  return noWitness(
    `${system(claim)} recorded ${String(changes.length - elsewhere.length)} changes on ${wanted}${humans === '' ? ' and none elsewhere' : `; the changes elsewhere were by ${humans}, not the session`}, but no witness attests coverage of its other environments for the window`,
    changes,
  );
};

const MIGRATED = /^(?:migrate|migration\.(?:applied|completed|succeeded))$/;
const MIGRATION_FAILED = /^migration\.(?:failed|reverted|rolled_back)$/;

const namesMigration = (event: Event, name: string): boolean =>
  str(event.attrs, 'db.migration') === name ||
  tokenIn(name, event.target?.resource ?? '') ||
  tokenIn(name, summaryOf(event));

export const migrationApplied: Checker = (claim, ctx): Finding => {
  const events = onSystem(claim, ctx.observed);
  if (events.length === 0) return notWatched(claim, 'migrations');
  const environment = placed(claim);
  const name = named(claim);
  if (environment === undefined) return noWitness('the claim names no environment to check it on');
  if (name === undefined) return noWitness('the claim names no migration');
  const about = events.filter(
    (e) =>
      e.kind === 'world.change' && e.target?.environment === environment && namesMigration(e, name),
  );
  const applied = about.filter((e) => MIGRATED.test(op(e)));
  if (applied.length > 0)
    return { outcome: 'holds', evidence: applied, reason: summaries(applied) };
  const failed = about.filter((e) => MIGRATION_FAILED.test(op(e)));
  if (failed.length > 0) {
    return { outcome: 'contradicted', evidence: failed, reason: summaries(failed) };
  }
  return noWitness(
    `${system(claim)} recorded no migration ${name} applied on ${environment} in the window`,
  );
};

const READY = /^deployment\.(?:ready|promoted)$/;

const unbound = (ctx: Context): Finding | undefined =>
  !ctx.witnessed
    ? noWitness(NO_GIT)
    : ctx.commits.size === 0
      ? headStayed(ctx, 'no deployment is bound to it')
      : undefined;

// A deployment is the session's when it built one of its commits.
export const deployReady: Checker = (claim, ctx): Finding => {
  const events = onSystem(claim, ctx.observed);
  if (events.length === 0) return notWatched(claim, 'deployments');
  const missing = unbound(ctx);
  if (missing !== undefined) return missing;
  const target = typeof claim.params.target === 'string' ? claim.params.target : undefined;
  const fits = (e: Event): boolean =>
    target === undefined ||
    (target === 'production'
      ? e.target?.environment === 'production'
      : e.target?.environment !== 'production');
  const mine = onSessionCommits(events, ctx).filter(fits);
  const ready = mine.filter((e) => READY.test(op(e)));
  if (ready.length > 0) return { outcome: 'holds', evidence: ready, reason: summaries(ready) };
  const errored = mine.filter((e) => op(e) === 'deployment.error');
  if (errored.length > 0) {
    return { outcome: 'contradicted', evidence: errored, reason: summaries(errored) };
  }
  return noWitness(
    `${system(claim)} recorded no ${target === undefined ? '' : `${target} `}deployment ready for this session's commits in the window`,
  );
};

const ROTATED = /^(?:secret\.rotated|rotated?|rotation\.(?:completed|succeeded))$/;
const ROTATION_FAILED = /^(?:secret\.rotation_failed|rotation\.failed)$/;

const squash = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, '');

const namesSecret = (event: Event, name: string): boolean =>
  squash(`${event.target?.resource ?? ''} ${summaryOf(event)}`).includes(squash(name));

export const secretRotated: Checker = (claim, ctx): Finding => {
  const events = onSystem(claim, ctx.observed);
  if (events.length === 0) return notWatched(claim, 'claims like this');
  const name = named(claim) ?? claim.subject.resource;
  if (name === undefined) return noWitness('the claim names no secret');
  const about = events.filter(
    (e) => e.kind === 'world.change' && !isHuman(e) && namesSecret(e, name),
  );
  const rotated = about.filter((e) => ROTATED.test(op(e)));
  if (rotated.length > 0)
    return { outcome: 'holds', evidence: rotated, reason: summaries(rotated) };
  const failed = about.filter((e) => ROTATION_FAILED.test(op(e)));
  if (failed.length > 0) {
    return { outcome: 'contradicted', evidence: failed, reason: summaries(failed) };
  }
  return noWitness(`${system(claim)} recorded no rotation of ${name} by the session in the window`);
};
