import { type Event, sortTimeline } from '@debrief/schema';

import type { Decision, Subject } from './evaluate.js';
import type { Effect, Policy } from './policy.js';
import { evaluateEvent } from './subject.js';

export type ReplayStatus = 'happened' | 'freeze-frame' | 'would-not-have-happened';

export interface FreezeFrame {
  eventId: string;
  effect: Exclude<Effect, 'allow'>;
  ruleId?: string;
  explanation: string;
}

export interface ReplayedEvent {
  event: Event;
  status: ReplayStatus;
}

export interface Counterfactual {
  halted: boolean;
  freezeFrame?: FreezeFrame;
  prefix: Event[];
  timeline: ReplayedEvent[];
  marked: string[];
}

// ARCHITECTURE §10: execution halts at the freeze frame; the prefix is the recorded events, untouched, and everything after is marked.
export function replay(
  events: readonly Event[],
  freezeFrame: FreezeFrame | undefined,
): Counterfactual {
  const ordered = sortTimeline(events);
  const at =
    freezeFrame === undefined ? -1 : ordered.findIndex((event) => event.id === freezeFrame.eventId);
  if (freezeFrame === undefined || at < 0) {
    return {
      halted: false,
      prefix: ordered,
      timeline: ordered.map((event) => ({ event, status: 'happened' })),
      marked: [],
    };
  }
  const timeline: ReplayedEvent[] = ordered.map((event, index) => ({
    event,
    status: index < at ? 'happened' : index === at ? 'freeze-frame' : 'would-not-have-happened',
  }));
  return {
    halted: true,
    freezeFrame,
    prefix: ordered.slice(0, at),
    timeline,
    marked: ordered.slice(at + 1).map((event) => event.id),
  };
}

export type Decide = (event: Event) => Decision;

export const decideWith =
  (policy: Policy, ctx?: Subject): Decide =>
  (event) =>
    evaluateEvent(event, policy, ctx);

// Bare replay: every event is judged on its own fields, in timeline order; the first non-allow halts the run.
export function counterfactual(events: readonly Event[], decide: Decide): Counterfactual {
  for (const event of sortTimeline(events)) {
    const decision = decide(event);
    if (decision.effect === 'allow') continue;
    const freezeFrame: FreezeFrame = {
      eventId: event.id,
      effect: decision.effect,
      explanation: decision.explanation,
    };
    if (decision.ruleId !== undefined) freezeFrame.ruleId = decision.ruleId;
    return replay(events, freezeFrame);
  }
  return replay(events, undefined);
}
