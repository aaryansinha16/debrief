import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { ensurePrivateDir, writePrivateFile } from './config.js';

export const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const stateSchema = z.strictObject({
  offset: z.number().int().nonnegative(),
  git: z.string().optional(),
});

export type SessionState = z.infer<typeof stateSchema>;

const sessionsDir = (configDir: string): string => join(configDir, 'claude-code', 'sessions');

export function readState(configDir: string, sessionId: string): SessionState {
  try {
    const text = readFileSync(join(sessionsDir(configDir), `${sessionId}.json`), 'utf8');
    return stateSchema.parse(JSON.parse(text));
  } catch {
    return { offset: 0 };
  }
}

export function writeState(configDir: string, sessionId: string, state: SessionState): void {
  ensurePrivateDir(sessionsDir(configDir));
  writePrivateFile(join(sessionsDir(configDir), `${sessionId}.json`), JSON.stringify(state));
}

export interface TranscriptLine {
  text: string;
  end: number;
}

// Complete lines only: one still being written waits for the next Stop. A shorter file restarts at 0.
export function readLines(path: string, offset: number, maxBytes: number): TranscriptLine[] {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return [];
  }
  try {
    const size = fstatSync(fd).size;
    const start = offset > size ? 0 : offset;
    const length = Math.min(size - start, maxBytes);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, start);
    const last = buffer.lastIndexOf(0x0a);
    if (last < 0) return length === maxBytes ? [{ text: '', end: start + length }] : [];
    const lines: TranscriptLine[] = [];
    for (let from = 0; from <= last;) {
      const newline = buffer.indexOf(0x0a, from);
      lines.push({ text: buffer.toString('utf8', from, newline), end: start + newline + 1 });
      from = newline + 1;
    }
    return lines;
  } finally {
    closeSync(fd);
  }
}
