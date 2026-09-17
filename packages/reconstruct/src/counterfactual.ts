import { type Counterfactual, type Policy, replay } from '@debrief/policy';
import type { Event } from '@debrief/schema';

import { divergence } from './divergence.js';
import { reconstructGraph } from './pipeline.js';
import type { CausalGraph } from './types.js';

// The run's counterfactual under another policy: P-27's freeze frame (judged with reconstructed context) halts the replay.
export function counterfactual(
  events: readonly Event[],
  policy: Policy,
  graph: CausalGraph = reconstructGraph(events),
): Counterfactual & { runId: string } {
  const report = divergence(events, policy, graph);
  const inRun = events.filter((event) => event.runId === graph.runId);
  const freeze = report.freezeFrame;
  return {
    runId: graph.runId,
    ...replay(
      inRun,
      freeze === undefined
        ? undefined
        : {
            eventId: freeze.eventId,
            effect: freeze.effect,
            explanation: freeze.explanation,
            ...(freeze.ruleId === undefined ? {} : { ruleId: freeze.ruleId }),
          },
    ),
  };
}
