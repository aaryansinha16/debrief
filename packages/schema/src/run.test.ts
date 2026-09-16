import { describe, expect, it } from 'vitest';

import { runSchema, type Run } from './run.js';

const validRun: Run = {
  id: '4bf92f3577b34da6a3ce929d0e0e4736',
  tenantId: 'tenant-a',
  principalId: 'human-1',
  agentName: 'coding-agent',
  startedAt: '2026-09-17T00:00:00Z',
  eventCount: 0,
  status: 'active',
  divergenceCount: 0,
  graphVersion: 1,
};

const withField = (patch: Record<string, unknown>): unknown => ({ ...validRun, ...patch });

describe('runSchema', () => {
  it('accepts an active run and an ended run with risk and layout', () => {
    expect(runSchema.parse(validRun)).toEqual(validRun);
    expect(
      runSchema.safeParse(
        withField({
          status: 'ended',
          endedAt: '2026-09-17T00:00:09Z',
          riskMax: 'critical',
          layout: { seed: 42, nodes: [] },
          agentName: '',
        }),
      ).success,
    ).toBe(true);
  });

  it.each([
    ['id', ''],
    ['principalId', ''],
    ['startedAt', '2026-09-17T00:00:00'],
    ['endedAt', 'later'],
    ['eventCount', -1],
    ['eventCount', 0.5],
    ['status', 'running'],
    ['riskMax', 'none'],
    ['divergenceCount', -1],
    ['layout', 'cached'],
    ['graphVersion', -1],
    ['extra', 1],
  ])('rejects bad %s', (field, value) => {
    expect(runSchema.safeParse(withField({ [field]: value })).success).toBe(false);
  });
});
