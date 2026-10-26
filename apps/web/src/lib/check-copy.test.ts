import { describe, expect, it } from 'vitest';

import { all, input } from './__fixtures__/mixed-session';
import {
  clockAt,
  dayAt,
  headlineOf,
  leadOf,
  listOf,
  numberWord,
  offsetLabel,
  offsetOf,
  ringLabel,
  sessionLine,
} from './check-copy';
import { type CheckCounts, buildSessionCheck } from './session-check';

const counts = (patch: Partial<CheckCounts>): CheckCounts => {
  const base = {
    holds: 0,
    contradicted: 0,
    noWitness: 0,
    local: 0,
    pending: 0,
    hedged: 0,
    ...patch,
  };
  return { ...base, claims: base.holds + base.contradicted + base.noWitness };
};
const line = (patch: Partial<CheckCounts>): string => {
  const { claims, verdict } = headlineOf(counts(patch));
  return `${claims} ${verdict}`;
};

describe('headlineOf', () => {
  it('says the canvas headline for four holds, two contradicted and one without a witness', () => {
    expect(headlineOf(counts({ holds: 4, contradicted: 2, noWitness: 1 }))).toEqual({
      claims: 'Seven claims.',
      verdict: 'Two fall apart.',
      tone: 'contradicted',
    });
  });

  it('agrees in number, and says all, both or it when every claim went one way', () => {
    expect(line({ holds: 5, contradicted: 1 })).toBe('Six claims. One falls apart.');
    expect(line({ contradicted: 1 })).toBe('One claim. It falls apart.');
    expect(line({ contradicted: 2 })).toBe('Two claims. Both fall apart.');
    expect(line({ contradicted: 13 })).toBe('13 claims. All 13 fall apart.');
    expect(line({ holds: 1 })).toBe('One claim. It holds.');
    expect(line({ holds: 3 })).toBe('Three claims. All three hold.');
    expect(headlineOf(counts({ holds: 3 })).tone).toBe('holds');
  });

  it('never calls a claim no witness saw a hold', () => {
    expect(line({ noWitness: 1 })).toBe('One claim. No witness could check it.');
    expect(line({ noWitness: 4 })).toBe('Four claims. No witness could check them.');
    expect(headlineOf(counts({ noWitness: 4 })).tone).toBe('muted');
    expect(line({ holds: 1, noWitness: 1 })).toBe('Two claims. One holds, one without a witness.');
    expect(line({ holds: 5, noWitness: 2 })).toBe(
      'Seven claims. Five hold, two without a witness.',
    );
  });

  it('has nothing to score when the agent claimed nothing or only hedged', () => {
    expect(line({})).toBe('No claims to check. Nothing the agent said can be checked.');
    expect(line({ hedged: 2 })).toBe('No claims to check. Two hedged, never scored.');
    expect(headlineOf(counts({ hedged: 1 })).tone).toBe('muted');
  });
});

describe('leadOf and ringLabel', () => {
  it('names the connected witnesses and what was not scored', () => {
    const check = buildSessionCheck(input(all));
    expect(leadOf(check)).toBe(
      'Every sentence the agent said about its work, checked against what Skyport, Forge, Tidewater and Local git actually recorded. One claim is not checked yet. One hedged claim is shown and never scored.',
    );
    const alone = { ...check, witnesses: [], counts: counts({ pending: 2, hedged: 3 }) };
    expect(leadOf(alone)).toBe(
      'No witness is connected, so nothing the agent said could be checked. Two claims are not checked yet. Three hedged claims are shown and never scored.',
    );
    expect(leadOf({ ...check, counts: counts({ holds: 1 }) })).not.toContain('hedged');
    expect([listOf([]), listOf(['A']), listOf(['A', 'B'])]).toEqual(['', 'A', 'A and B']);
  });

  it('states every count in the ring name, and the claims backed only by local evidence', () => {
    expect(ringLabel(counts({ holds: 4, contradicted: 2, noWitness: 1, local: 1 }))).toBe(
      '4 of 7 claims hold, 2 contradicted, 1 without a witness; 1 backed only by local evidence',
    );
    expect(ringLabel(counts({ holds: 1 }))).toBe(
      '1 of 1 claim holds, 0 contradicted, 0 without a witness',
    );
    expect(ringLabel(counts({}))).toBe('No claims checked');
  });
});

describe('session times', () => {
  it('reads a timestamp in the offset it was written in', () => {
    expect(offsetOf('2026-10-25T14:02:00.000+05:30')).toBe(330);
    expect(offsetOf('2026-10-25T14:02:00.000-04:00')).toBe(-240);
    expect(offsetOf('2026-10-25T14:02:00.000Z')).toBe(0);
    expect(clockAt('2026-10-25T08:52:07.000Z', 330)).toBe('14:22:07');
    expect([offsetLabel(330), offsetLabel(-240), offsetLabel(0)]).toEqual([
      'UTC+05:30',
      'UTC−04:00',
      'UTC',
    ]);
    expect(dayAt('2026-10-25T20:00:00.000Z', 330)).toBe('26 Oct 2026');
    expect(numberWord(0)).toBe('zero');
  });

  it('writes the meta line with or without an end and a project', () => {
    const session = {
      id: 's',
      agent: 'claude-code',
      project: 'acme/billing-api',
      startedAt: '2026-10-25T14:02:00.000+05:30',
      endedAt: '2026-10-25T09:01:00.000Z',
      sample: true,
    };
    expect(sessionLine(session)).toBe(
      'Claude Code · acme/billing-api · 25 Oct 2026 · 14:02–14:31 UTC+05:30',
    );
    expect(sessionLine({ ...session, project: undefined, endedAt: undefined })).toBe(
      'Claude Code · 25 Oct 2026 · from 14:02 UTC+05:30',
    );
  });
});
