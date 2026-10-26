import { eventInputSchema } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import golden from '../__golden__/tests-events.json';
import { JUNIT_COUNTS, rest } from './__fixtures__/index.js';
import { mapWorkflowRunTests, workflowRunSchema } from './index.js';

const REPO = 'acme-demo/widgets';
const failing = workflowRunSchema.parse(rest.runs[0]);

describe('mapWorkflowRunTests', () => {
  it('maps to its own world.change on the run, matching the golden', () => {
    const events = mapWorkflowRunTests(REPO, failing, { counts: JUNIT_COUNTS, source: 'junit' });
    expect(events).toEqual(golden);
    const [event] = events;
    const { sourceId: _sourceId, ...wire } = event!;
    const parsed = eventInputSchema.safeParse({
      ...wire,
      id: '01JZ0000000000000000000000',
      ts: '2026-10-20T12:00:00.000Z',
      tenantId: 't1',
    });
    expect(parsed.error?.issues).toBeUndefined();
    expect(event?.attrs['witness.trust']).toBe('third-party');
    expect(event?.sourceId).toBe('github:workflow_run_tests:acme-demo/widgets:7002:2:15.2.2');
  });

  it('keeps the same run event identity apart from the job counts event', () => {
    const [event] = mapWorkflowRunTests(REPO, failing, { counts: JUNIT_COUNTS, source: 'junit' });
    expect(event?.target.operation).toBe('workflow_run.tests');
    expect(event?.attrs).not.toHaveProperty('ci.jobs.passed');
  });

  it('maps a run without a name or actor to a system actor', () => {
    const run = workflowRunSchema.parse({
      id: 5,
      status: 'completed',
      conclusion: 'success',
      head_sha: 'abcdef0123',
      updated_at: '2026-10-20T10:00:00Z',
    });
    const [event] = mapWorkflowRunTests('a/b', run, { counts: JUNIT_COUNTS, source: 'check-run' });
    expect(event?.actor).toEqual({ type: 'system', id: 'github' });
    expect(event?.summary).toContain('workflow run #5 tests');
  });

  it('maps nothing for a run that has not finished', () => {
    const run = workflowRunSchema.parse(rest.runs[2]);
    expect(mapWorkflowRunTests(REPO, run, { counts: JUNIT_COUNTS, source: 'junit' })).toEqual([]);
  });
});
