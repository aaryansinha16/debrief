import type { EventInput } from './event.js';

export interface EventIssue {
  path: (string | number)[];
  message: string;
}

export type EventCheckMode = 'stored' | 'input';

export type CheckedEvent = Pick<EventInput, 'kind' | 'provenance' | 'attrs' | 'target'>;

interface IssueSink {
  addIssue(issue: { code: 'custom'; path: (string | number)[]; message: string }): void;
}

// D-083: claims and verdicts are derived, and nothing else is.
export function eventIssues(event: CheckedEvent, _mode: EventCheckMode): EventIssue[] {
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
  return issues;
}

export function checkEvent(mode: EventCheckMode) {
  return (event: CheckedEvent, ctx: IssueSink): void => {
    for (const issue of eventIssues(event, mode)) ctx.addIssue({ code: 'custom', ...issue });
  };
}
