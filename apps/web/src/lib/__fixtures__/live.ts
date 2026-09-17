import type { Event, Run } from '@debrief/schema';

let seq = 0;

// Minimal well-formed events and runs for the approach tests; ids and seqs count up per process.
export const liveEvent = (overrides: Partial<Event> & { runId: string }): Event => {
  seq += 1;
  return {
    id: `01ARZ3NDEKTSV4RRFFQ69G5F${String(seq % 100).padStart(2, '0')}`,
    tenantId: 't',
    seq,
    ts: '2026-09-17T00:00:00Z',
    sourceTs: '2026-09-17T00:00:00Z',
    source: 'api',
    provenance: 'reported',
    kind: 'tool.call',
    actor: { type: 'agent', id: 'bot', name: 'bot' },
    attrs: {},
    prevHash: '0'.repeat(64),
    hash: '1'.repeat(64),
    ...overrides,
  };
};

export const liveRun = (id: string, overrides: Partial<Run> = {}): Run => ({
  id,
  tenantId: 't',
  principalId: 'human:aaryan',
  agentName: 'coding-agent',
  startedAt: '2026-09-17T00:00:00Z',
  eventCount: 3,
  status: 'active',
  divergenceCount: 0,
  graphVersion: 1,
  ...overrides,
});
