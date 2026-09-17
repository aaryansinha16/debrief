import type { Event } from '@debrief/schema';

import { withConsequences } from './blast.js';
import { applyWorldLinks, correlateWorld } from './correlate.js';
import { type BuildGraphOptions, buildGraph } from './graph.js';
import type { CausalGraph } from './types.js';

// The full reconstruction: causal graph, world correlation applied, derived consequences.
export function reconstructGraph(
  events: readonly Event[],
  options: BuildGraphOptions = {},
): CausalGraph {
  const base = buildGraph(events, options);
  return withConsequences(applyWorldLinks(base, correlateWorld(events, base), events), events);
}
