import type { WitnessTrust } from '@debrief/schema';

const RANK: Record<WitnessTrust, number> = { local: 0, 'third-party': 1 };

// D-084: a key asserts, issues and manages nothing above its own trust.
export const exceedsTrust = (trust: WitnessTrust, ceiling: WitnessTrust): boolean =>
  RANK[trust] > RANK[ceiling];
