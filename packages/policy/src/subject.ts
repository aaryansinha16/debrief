import { type Event, scopeMismatchOf } from '@debrief/schema';

import { type Decision, type Subject, evaluate } from './evaluate.js';
import type { Policy } from './policy.js';

// ARCHITECTURE §10: `authority.scopeMismatch` is derived, true only for a major mismatch (wildcards, foreign namespaces, target outside scope).
export function subjectOf(event: Event): Subject {
  const subject: Subject = { ...event };
  if (event.authority !== undefined) {
    const mismatch = scopeMismatchOf(event.authority, event.target);
    subject.authority = {
      ...event.authority,
      scopeMismatch: mismatch?.severity === 'major',
      scopeExcess: mismatch?.excess ?? [],
    };
  }
  return subject;
}

export function evaluateEvent(event: Event, policy: Policy, ctx?: Subject): Decision {
  return evaluate(subjectOf(event), policy, ctx);
}
