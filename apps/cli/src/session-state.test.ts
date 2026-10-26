import { appendFileSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SESSION_ID, readLines, readState, writeState } from './session-state.js';

const temp = (): string => mkdtempSync(join(tmpdir(), 'debrief-session-'));

describe('session state', () => {
  it('starts at offset 0 and round-trips privately', () => {
    const dir = temp();
    expect(readState(dir, 's1')).toEqual({ offset: 0 });
    writeState(dir, 's1', { offset: 12, git: 'abc' });
    expect(readState(dir, 's1')).toEqual({ offset: 12, git: 'abc' });
    expect(statSync(join(dir, 'claude-code', 'sessions', 's1.json')).mode & 0o777).toBe(0o600);
    writeFileSync(join(dir, 'claude-code', 'sessions', 's2.json'), '{"offset":-1}');
    expect(readState(dir, 's2')).toEqual({ offset: 0 });
  });

  it('accepts session ids that are safe file names only', () => {
    expect(SESSION_ID.test('5d1c7a90-1b2e-4c3d-9e8f-0a1b2c3d4e5f')).toBe(true);
    for (const id of ['../x', '', '.hidden', 'a/b', 'x'.repeat(129)]) {
      expect(SESSION_ID.test(id), id).toBe(false);
    }
  });
});

describe('readLines', () => {
  it('returns complete lines with the byte offset after each, multibyte included', () => {
    const file = join(temp(), 't.jsonl');
    writeFileSync(file, 'é1\nb2\npartial');
    expect(readLines(file, 0, 1024)).toEqual([
      { text: 'é1', end: 4 },
      { text: 'b2', end: 7 },
    ]);
    expect(readLines(file, 7, 1024)).toEqual([]);
    appendFileSync(file, '\nc3\n');
    expect(readLines(file, 7, 1024)).toEqual([
      { text: 'partial', end: 15 },
      { text: 'c3', end: 18 },
    ]);
  });

  it('restarts a shorter file, stops at the read window and skips a line wider than it', () => {
    const file = join(temp(), 't.jsonl');
    writeFileSync(file, 'aa\nbb\n');
    expect(readLines(file, 999, 1024).map((line) => line.text)).toEqual(['aa', 'bb']);
    expect(readLines(file, 0, 4)).toEqual([{ text: 'aa', end: 3 }]);
    writeFileSync(file, 'x'.repeat(10));
    expect(readLines(file, 0, 4)).toEqual([{ text: '', end: 4 }]);
    expect(readLines(join(temp(), 'missing.jsonl'), 0, 4)).toEqual([]);
  });
});
