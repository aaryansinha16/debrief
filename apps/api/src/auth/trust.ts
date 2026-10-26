import type { WitnessTrust } from '@debrief/schema';

const RANK: Partial<Record<string, number>> = { local: 0, 'third-party': 1 };

// D-084: a key asserts, issues and manages nothing above its own trust; an unknown value fails closed.
export const exceedsTrust = (trust: WitnessTrust, ceiling: WitnessTrust): boolean =>
  (RANK[trust] ?? Number.POSITIVE_INFINITY) > (RANK[ceiling] ?? Number.NEGATIVE_INFINITY);
