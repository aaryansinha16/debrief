import { describe, expect, it } from 'vitest';

import { VENDOR_NAMES, VENDOR_TERMS, realNameLeaks } from './__fixtures__/real-names';
import { SYSTEM_LABELS, isKnownSystem, systemLabel } from './systems';

describe('systemLabel', () => {
  it('names a known system and falls back to the id for any other', () => {
    expect(systemLabel('github')).toBe('GitHub');
    expect(systemLabel('git')).toBe('Local git');
    expect(systemLabel('payroll')).toBe('payroll');
    expect(isKnownSystem('toString')).toBe(false);
  });

  it('labels real systems by name (D-079) and nothing else: the agent stays generic', () => {
    expect(JSON.stringify(SYSTEM_LABELS)).not.toMatch(VENDOR_TERMS);
    expect(systemLabel('coding-agent')).toBe('Coding agent');
    expect(systemLabel('secrets')).toBe('Secrets manager');
  });
});

describe('the real-name guard', () => {
  it('recognises a vendor API, field, event or product name or id prefix as a whole word', () => {
    const terms = ['Claude Code', 'webhookEndpoints.del', 'livemode', 'workflow_run.completed'];
    const more = ['acme/actions/runs/1', 'deployment.ready', 'toolu_01', 'req_7x', 'we_0Tq'];
    for (const term of [...terms, ...more]) expect(term).toMatch(VENDOR_TERMS);
    for (const name of ['GitHub', 'Neon', 'Stripe']) expect(name).toMatch(VENDOR_NAMES);
    for (const word of ['laws', 'draws', 'awesome', 'neonate', 'hooks.remove', 'rq-7xQ2mB']) {
      expect(word).not.toMatch(VENDOR_TERMS);
      expect(word).not.toMatch(VENDOR_NAMES);
    }
  });

  it('lets a vendor name be a system and nothing else, in keys and values alike', () => {
    const fixture = {
      runId: 'witness:github:2026-10-25',
      actor: { id: 'github-witness' },
      target: { system: 'github', operation: 'pr.opened' },
      roster: [{ system: 'stripe' }],
      count: 2,
      flag: null,
    };
    expect(realNameLeaks(fixture)).toEqual([]);
    expect(realNameLeaks({ summary: 'GitHub run 7', attrs: { 'github.pr.number': 3 } })).toEqual([
      'summary: GitHub run 7',
      'key github.pr.number',
    ]);
    expect(realNameLeaks({ system: 'github', operation: 'workflow_run.completed' })).toEqual([
      'operation: workflow_run.completed',
    ]);
    expect(realNameLeaks({ runId: 'witness:github:soon', id: 'github-bot' })).toHaveLength(2);
  });
});
