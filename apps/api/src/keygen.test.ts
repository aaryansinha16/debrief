import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deriveKeyId, generateKeypair } from '@debrief/chain';
import { hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';

const run = (out: string): string =>
  execFileSync('pnpm', ['exec', 'tsx', 'src/keygen.ts', out], { encoding: 'utf8' });

describe('keygen', () => {
  it('writes the secret to a 0600 file and prints only the public entry', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'debrief-keygen-')), 'key.json');
    const stdout = run(out);
    const printed = JSON.parse(stdout) as Record<string, unknown>;
    expect(Object.keys(printed).sort()).toEqual(['alg', 'keyId', 'publicKey']);
    const record = JSON.parse(readFileSync(out, 'utf8')) as Record<string, string>;
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(record.secretKey).toMatch(/^[0-9a-f]{64}$/);
    expect(stdout).not.toContain(record.secretKey);
    const derived = generateKeypair(hexToBytes(record.secretKey!));
    expect(deriveKeyId(derived.publicKey)).toBe(printed.keyId);
    expect(record.publicKey).toBe(printed.publicKey);
    expect(() => run(out)).toThrow();
  });
});
