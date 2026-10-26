import type { Event, Target, VerdictOutcome, WitnessTrust } from '@debrief/schema';

export interface Window {
  from: string;
  to: string;
}

export interface CheckInput {
  events: readonly Event[];
  window: Window;
}

export type ParamValue = string | number;

export interface ClaimRecord {
  id: string;
  seq: number;
  runId: string;
  saidAt: string;
  text: string;
  modality: 'asserted' | 'hedged';
  predicate: string;
  subject: Target;
  params: Record<string, ParamValue>;
}

// ARCHITECTURE §18.4: holds and contradicted cite observed ids and carry the trust that backed them.
export interface Verdict {
  claimId: string;
  outcome: VerdictOutcome;
  evidence: string[];
  trust?: WitnessTrust;
  checker: string;
  reason: string;
  supersedes?: string;
}

export interface Context {
  observed: readonly Event[];
  witnessed: boolean;
  baseCommit?: string;
  latestCommit?: string;
  commits: ReadonlySet<string>;
  editedPaths: ReadonlySet<string>;
}

export interface Finding {
  outcome: VerdictOutcome;
  evidence: readonly Event[];
  reason: string;
}

export type Checker = (claim: ClaimRecord, ctx: Context) => Finding;
