import { describe, expect, it } from 'vitest';

import { SHA_A, WINDOW, claim, gitState, ist } from '../__fixtures__/index.js';
import { verdicts } from '../check.js';

const at = ist('14:20:00');
const one = (events: Parameters<typeof verdicts>[0]['events']) =>
  verdicts({ events, window: WINDOW })[0]!;
const files = (params: Record<string, string | number> = {}) =>
  claim({
    n: 1,
    at,
    text: 'edited',
    predicate: 'files.changed',
    subject: { system: 'git' },
    params,
  });
const removed = (params: Record<string, string | number> = {}, resource?: string) =>
  claim({
    n: 2,
    at,
    text: 'removed',
    predicate: 'code.removed',
    subject: { system: 'git', ...(resource === undefined ? {} : { resource }) },
    params,
  });

const state = gitState(10, at, SHA_A, [
  [0, 14, 'src/flags.ts'],
  [12, 3, 'src/billing/invoice.ts'],
  ['-', '-', 'img.png'],
]);

describe('files.changed', () => {
  it('holds on a working copy that touched the path, matched the count, or changed anything', () => {
    expect(one([files({ path: 'src/flags.ts' }), state])).toMatchObject({
      outcome: 'holds',
      trust: 'local',
      evidence: [state.id],
    });
    expect(one([files({ path: 'flags.ts' }), state]).outcome).toBe('holds');
    expect(one([files({ count: 3 }), state]).outcome).toBe('holds');
    expect(one([files(), state]).outcome).toBe('holds');
  });

  it('waits without the witness, and names what the working copy did show', () => {
    expect(one([files()]).reason).toBe(
      'no local git witness recorded the working copy (install the Claude Code hook)',
    );
    expect(one([files({ path: 'src/other.ts' }), state]).reason).toBe(
      'the working copy showed changes to src/flags.ts, src/billing/invoice.ts, img.png, not src/other.ts',
    );
    expect(one([files({ count: 2 }), state]).reason).toMatch(
      /^the working copy showed changes to src\/flags\.ts/,
    );
    const clean = gitState(11, at, SHA_A, []);
    expect(one([files(), clean]).reason).toBe('the working copy showed changes to nothing');
    const { 'git.files': _n, ...uncounted } = clean.attrs;
    expect(one([files(), { ...clean, attrs: uncounted }]).outcome).toBe('no-witness');
    const many = gitState(
      12,
      at,
      SHA_A,
      Array.from({ length: 9 }, (_, n) => [1, 0, `f${String(n)}`]),
    );
    expect(one([files({ path: 'zzz' }), many]).reason).toBe(
      'the working copy showed changes to f0, f1, f2, f3, f4, f5, f6, f7, not zzz',
    );
  });
});

describe('files.changed as a scope claim', () => {
  const only = (text: string, params: Record<string, string | number> = {}) =>
    claim({ n: 3, at, text, predicate: 'files.changed', subject: { system: 'git' }, params });

  it('holds only when the working copy changed that path and nothing else', () => {
    const alone = gitState(11, at, SHA_A, [[0, 14, 'src/flags.ts']]);
    expect(
      one([only('I only changed src/flags.ts.', { path: 'src/flags.ts' }), alone]),
    ).toMatchObject({
      outcome: 'holds',
      trust: 'local',
      reason: 'the working copy changed src/flags.ts and nothing else',
    });
    expect(
      one([only('I only changed src/flags.ts.', { path: 'src/flags.ts' }), state]).reason,
    ).toBe(
      "the working copy showed changes to src/flags.ts, src/billing/invoice.ts, img.png, and no witness tells which were the session's",
    );
    const twins = gitState(13, at, SHA_A, [
      [1, 0, 'src/a/index.ts'],
      [1, 0, 'src/b/index.ts'],
    ]);
    expect(one([only('I only changed index.ts.', { path: 'index.ts' }), twins]).outcome).toBe(
      'no-witness',
    );
    const clean = gitState(12, at, SHA_A, []);
    expect(
      one([only('I just changed src/flags.ts.', { path: 'src/flags.ts' }), clean]).reason,
    ).toBe(
      "the working copy showed changes to nothing, and no witness tells which were the session's",
    );
    expect(one([only('Nothing else changed.'), state]).reason).toBe(
      'the claim names no path to hold it to',
    );
  });
});

describe('code.removed', () => {
  it('holds when lines left a path naming the thing, by param or by subject resource', () => {
    const oauth = gitState(14, at, SHA_A, [[0, 2, 'src/oauth.ts']]);
    expect(one([removed({ name: 'auth' }), oauth]).outcome).toBe('no-witness');
    expect(one([removed({ name: 'flags' }), state])).toMatchObject({
      outcome: 'holds',
      evidence: [state.id],
    });
    expect(one([removed({}, 'src/flags.ts'), state]).outcome).toBe('holds');
    expect(one([removed({ name: 'FLAGS.TS' }), state]).outcome).toBe('holds');
  });

  it('waits when nothing was removed there, nothing was named, or there is no witness', () => {
    expect(one([removed({ name: 'invoice.spec' }), state]).reason).toBe(
      'the working copy showed no lines removed from a path naming invoice.spec',
    );
    expect(one([removed({ name: 'img.png' }), state]).outcome).toBe('no-witness');
    expect(one([removed(), state]).reason).toBe('the claim names nothing that was removed');
    expect(one([removed({ name: 'x' })]).reason).toMatch(/no local git witness/);
  });
});
