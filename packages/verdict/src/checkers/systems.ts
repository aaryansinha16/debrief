import type { Event } from '@debrief/schema';

import { op, str, summaryOf } from '../select.js';
import type { Checker, ClaimRecord, Finding } from '../types.js';
import { noWitness } from './ci.js';

const system = (claim: ClaimRecord): string => claim.subject.system;

const onSystem = (claim: ClaimRecord, events: readonly Event[]): Event[] =>
  events.filter((e) => e.target?.system === system(claim));

// A claim that names an environment is judged only on events that name the same one.
const sameEnvironment = (claim: ClaimRecord, event: Event): boolean => {
  const wanted = claim.subject.environment;
  return wanted === undefined || wanted === 'unknown' || event.target?.environment === wanted;
};

const summaries = (events: readonly Event[]): string => events.map(summaryOf).join('; ');

const notWatched = (claim: ClaimRecord, what: string): Finding =>
  noWitness(`nothing is watching ${system(claim)}: connect a witness and ${what} get checked`);

// A scope claim is contradicted by one change elsewhere; it holds only with coverage no witness attests yet (§18.4).
export const dbScope: Checker = (claim, ctx): Finding => {
  const changes = onSystem(claim, ctx.observed).filter((e) => e.kind === 'world.change');
  if (changes.length === 0) return notWatched(claim, 'claims about its scope');
  const wanted =
    typeof claim.params.environment === 'string'
      ? claim.params.environment
      : claim.subject.environment;
  if (wanted === undefined || wanted === 'unknown') {
    return noWitness('the claim names no environment to hold it to');
  }
  const outside = changes.filter((e) => {
    const environment = e.target?.environment;
    return environment !== undefined && environment !== 'unknown' && environment !== wanted;
  });
  if (outside.length > 0) {
    return {
      outcome: 'contradicted',
      evidence: outside,
      reason: `${system(claim)} recorded a change outside ${wanted}: ${summaries(outside)}`,
    };
  }
  return noWitness(
    `${system(claim)} recorded ${String(changes.length)} changes on ${wanted} and none elsewhere, but no witness attests coverage of its other environments for the window`,
    changes,
  );
};

export const migrationApplied: Checker = (claim, ctx): Finding => {
  const events = onSystem(claim, ctx.observed);
  if (events.length === 0) return notWatched(claim, 'migrations');
  const name = typeof claim.params.name === 'string' ? claim.params.name : undefined;
  const found = events.filter((e) => {
    if (!sameEnvironment(claim, e) || e.kind !== 'world.change') return false;
    if (!/migrat/i.test(op(e))) return false;
    const migration = str(e.attrs, 'db.migration') ?? '';
    return (
      name === undefined ||
      migration === name ||
      (e.target?.resource ?? '').includes(name) ||
      summaryOf(e).includes(name)
    );
  });
  if (found.length > 0) {
    return { outcome: 'holds', evidence: found, reason: summaries(found) };
  }
  return noWitness(
    `${system(claim)} recorded no migration${name === undefined ? '' : ` ${name}`}${claim.subject.environment === undefined ? '' : ` on ${claim.subject.environment}`} in the window`,
  );
};

const PREVIEW_READY = /^deployment\.(?:ready|promoted)$/;

export const deployReady: Checker = (claim, ctx): Finding => {
  const events = onSystem(claim, ctx.observed);
  if (events.length === 0) return notWatched(claim, 'deployments');
  const target = typeof claim.params.target === 'string' ? claim.params.target : undefined;
  const fits = (e: Event): boolean =>
    target === undefined ||
    (target === 'production'
      ? e.target?.environment === 'production'
      : e.target?.environment !== 'production');
  const ready = events.filter((e) => PREVIEW_READY.test(op(e)) && fits(e));
  if (ready.length > 0) {
    return { outcome: 'holds', evidence: ready, reason: summaries(ready) };
  }
  const errored = events.filter((e) => op(e) === 'deployment.error' && fits(e));
  if (errored.length > 0) {
    return { outcome: 'contradicted', evidence: errored, reason: summaries(errored) };
  }
  return noWitness(
    `${system(claim)} recorded no ${target ?? ''} deployment ready in the window`.replace(
      '  ',
      ' ',
    ),
  );
};

export const secretRotated: Checker = (claim, ctx): Finding => {
  const events = onSystem(claim, ctx.observed);
  if (events.length === 0) return notWatched(claim, 'claims like this');
  const name = typeof claim.params.name === 'string' ? claim.params.name.toLowerCase() : undefined;
  const found = events.filter(
    (e) =>
      e.kind === 'world.change' &&
      /rotat/i.test(op(e)) &&
      (name === undefined ||
        `${e.target?.resource ?? ''} ${summaryOf(e)}`.toLowerCase().includes(name)),
  );
  if (found.length > 0) {
    return { outcome: 'holds', evidence: found, reason: summaries(found) };
  }
  return noWitness(`${system(claim)} recorded no rotation in the window`);
};
