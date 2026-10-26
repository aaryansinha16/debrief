import type { Actor, Attrs, EventKind, Target } from '@debrief/schema';

export interface WireEvent {
  source: 'api' | 'world-hook';
  provenance: 'reported' | 'observed';
  kind: EventKind;
  sourceId: string;
  sourceTs: string;
  runId: string;
  actor: Actor;
  target?: Target;
  attrs: Attrs;
  summary?: string;
  content?: Record<string, string>;
}
