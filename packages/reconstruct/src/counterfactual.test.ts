import { ALLOW_ALL, type Policy, parsePolicy } from '@debrief/policy';
import { sortTimeline } from '@debrief/schema';
import { describe, expect, it } from 'vitest';

import counterfactualGolden from '../__golden__/nine-seconds.counterfactual.json';
import { DEMO_RUN_ID, demoRunFixture } from './__fixtures__/nine-seconds.js';
import { counterfactual } from './counterfactual.js';
import { divergence } from './divergence.js';
import { reconstructGraph } from './pipeline.js';

const prodGuard = parsePolicy(`
version: 1
rules:
  - id: prod-destructive-needs-approval
    match: { target.environment: production, target.risk: [high, critical], target.operation: [delete, drop, truncate, transfer] }
    effect: require_approval
`);
const DENY_ALL: Policy = { version: 1, defaults: 'deny', rules: [] };

describe('counterfactual on the demo run', () => {
  const events = demoRunFixture();
  const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
  const run = sortTimeline(events.filter((event) => event.runId === DEMO_RUN_ID));

  it('halts at the freeze frame, marks what follows and keeps the prefix byte-identical', () => {
    const result = counterfactual(events, prodGuard, graph);
    expect(result).toEqual(counterfactualGolden);
    const freeze = divergence(events, prodGuard, graph).freezeFrame!;
    expect(result.freezeFrame).toEqual({
      eventId: freeze.eventId,
      effect: 'require_approval',
      ruleId: 'prod-destructive-needs-approval',
      explanation: freeze.explanation,
    });
    const at = run.findIndex((event) => event.id === freeze.eventId);
    expect(run[at]?.seq).toBe(45);
    expect(result.halted).toBe(true);
    expect(JSON.stringify(result.prefix)).toBe(JSON.stringify(run.slice(0, at)));
    expect(result.marked).toEqual(run.slice(at + 1).map((event) => event.id));
    expect(result.timeline.map((entry) => entry.status)).toEqual([
      ...Array<string>(at).fill('happened'),
      'freeze-frame',
      ...Array<string>(run.length - at - 1).fill('would-not-have-happened'),
    ]);
    const markedKinds = result.marked.map((id) => events.find((event) => event.id === id)?.kind);
    expect(markedKinds).toEqual(['world.change', 'mcp.response', 'tool.result', 'llm.call']);
    expect(run.slice(at + 1).map((event) => event.kind)).toEqual(markedKinds);
    expect(result.runId).toBe(DEMO_RUN_ID);
    expect(result.timeline.every((entry) => entry.event.runId === DEMO_RUN_ID)).toBe(true);
  });

  it('halts nowhere under allow-all and reconstructs the graph itself when none is given', () => {
    const open = counterfactual(events, ALLOW_ALL, graph);
    expect(open.halted).toBe(false);
    expect(open.prefix).toEqual(run);
    expect(open.marked).toEqual([]);
    expect(counterfactual(events, prodGuard)).toEqual(counterfactualGolden);
  });

  it('carries a freeze frame without a rule id', () => {
    const denied = counterfactual(events, DENY_ALL, graph);
    expect(denied.freezeFrame).toEqual({
      eventId: run.find((event) => event.kind === 'tool.call')?.id,
      effect: 'deny',
      explanation: 'no rule matched; default deny',
    });
    const firstCall = run.findIndex((event) => event.kind === 'tool.call');
    expect(denied.prefix).toEqual(run.slice(0, firstCall));
    expect(denied.prefix.map((event) => event.kind)).not.toContain('tool.call');
    expect(denied.prefix.map((event) => event.kind)).toContain('llm.call');
  });
});
