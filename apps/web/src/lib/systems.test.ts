import { describe, expect, it } from 'vitest';

import { REAL_NAMES } from './__fixtures__/real-names';
import { SYSTEM_LABELS, isKnownSystem, systemLabel } from './systems';

describe('systemLabel', () => {
  it('names a known system and falls back to the id for any other', () => {
    expect(systemLabel('tidewater')).toBe('Tidewater');
    expect(systemLabel('git')).toBe('Local git');
    expect(systemLabel('payroll')).toBe('payroll');
    expect(isKnownSystem('toString')).toBe(false);
  });

  it('keeps real vendor names out until D-079 covers web fixtures', () => {
    expect(JSON.stringify(SYSTEM_LABELS)).not.toMatch(REAL_NAMES);
  });

  it('recognises a vendor, product, API, field, event name or id prefix as a whole word', () => {
    const real = [
      'GitHub',
      'Claude Code',
      'webhookEndpoints.del',
      'livemode',
      'workflow_run.completed',
    ];
    const more = ['acme/actions/runs/1', 'deployment.ready', 'toolu_01', 'req_7x', 'we_0Tq'];
    for (const name of [...real, ...more]) expect(name).toMatch(REAL_NAMES);
    for (const name of ['laws', 'draws', 'Forge', 'hooks.remove', 'rq-7xQ2mB', 'awesome']) {
      expect(name).not.toMatch(REAL_NAMES);
    }
  });
});
