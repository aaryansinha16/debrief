import type { ZodType } from 'zod';

import { claimAttrsSchema } from './claim.js';
import type { EventInput } from './event.js';
import { witnessTrustSchema } from './primitives.js';
import { verdictAttrsSchema } from './verdict.js';

export const WITNESS_TRUST_ATTR = 'witness.trust';

const RESERVED_PREFIXES = ['witness.', 'claim.', 'verdict.'] as const;

// Namespaces only Debrief and its witnesses assign (D-083); agent telemetry never carries them.
export function isReservedAttribute(name: string): boolean {
  return RESERVED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export interface EventIssue {
  path: (string | number)[];
  message: string;
}

export type EventCheckMode = 'stored' | 'input';

export type CheckedEvent = Pick<EventInput, 'kind' | 'provenance' | 'attrs' | 'target'>;

interface IssueSink {
  addIssue(issue: { code: 'custom'; path: (string | number)[]; message: string }): void;
}

// D-083: claims and verdicts are derived, and nothing else is; only observed events carry witness trust.
export function eventIssues(event: CheckedEvent, mode: EventCheckMode): EventIssue[] {
  const issues: EventIssue[] = [];
  const derivedKind = event.kind === 'claim' || event.kind === 'verdict';
  if (derivedKind && event.provenance !== 'derived') {
    issues.push({ path: ['provenance'], message: `${event.kind} events are derived` });
  }
  if (!derivedKind && event.provenance === 'derived') {
    issues.push({ path: ['provenance'], message: 'only claim and verdict events are derived' });
  }
  if (event.kind === 'world.read' && event.provenance !== 'observed') {
    issues.push({ path: ['provenance'], message: 'world.read events are observed' });
  }
  if (mode === 'input') issues.push(...trustIssues(event), ...namespaceIssues(event));
  if (event.kind === 'claim') {
    if (event.target === undefined) {
      issues.push({ path: ['target'], message: 'a claim names its subject in target' });
    }
    issues.push(...attrIssues(claimAttrsSchema, event.attrs));
  }
  if (event.kind === 'verdict') issues.push(...attrIssues(verdictAttrsSchema, event.attrs));
  return issues;
}

function attrIssues(schema: ZodType, attrs: CheckedEvent['attrs']): EventIssue[] {
  const result = schema.safeParse(attrs);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({
        path: ['attrs', ...issue.path.map(String)],
        message: issue.message,
      }));
}

// Ingest only: the chain keeps whatever was valid when appended, so reading never rejects history.
function trustIssues(event: CheckedEvent): EventIssue[] {
  const path = ['attrs', WITNESS_TRUST_ATTR];
  const trust = event.attrs[WITNESS_TRUST_ATTR];
  if (event.provenance !== 'observed') {
    return trust === undefined
      ? []
      : [{ path, message: `${WITNESS_TRUST_ATTR} belongs on observed events only` }];
  }
  if (trust === undefined) {
    return [{ path, message: `observed events carry ${WITNESS_TRUST_ATTR} (local | third-party)` }];
  }
  return witnessTrustSchema.safeParse(trust).success
    ? []
    : [{ path, message: `${WITNESS_TRUST_ATTR} is local or third-party` }];
}

function namespaceIssues(event: CheckedEvent): EventIssue[] {
  return Object.keys(event.attrs).flatMap((name) => {
    const owner = name.startsWith('claim.')
      ? 'claim'
      : name.startsWith('verdict.')
        ? 'verdict'
        : '';
    return owner === '' || owner === event.kind
      ? []
      : [{ path: ['attrs', name], message: `${name} belongs on ${owner} events only` }];
  });
}

export function checkEvent(mode: EventCheckMode) {
  return (event: CheckedEvent, ctx: IssueSink): void => {
    for (const issue of eventIssues(event, mode)) ctx.addIssue({ code: 'custom', ...issue });
  };
}
