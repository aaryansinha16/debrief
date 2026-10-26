import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { configFile, readConfig, removeConfig, writeConfig } from './config.js';

const KEY = `dbf_${'k'.repeat(43)}`;

describe('config', () => {
  it('writes the key to a 600 file in a 700 directory and reads it back', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'debrief-config-')), 'debrief');
    writeConfig(dir, { apiUrl: 'http://localhost:4000', key: KEY, keyId: 'k1' });
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(configFile(dir)).mode & 0o777).toBe(0o600);
    expect(readConfig(dir)).toEqual({ apiUrl: 'http://localhost:4000', key: KEY, keyId: 'k1' });
    removeConfig(dir);
    expect(readConfig(dir)).toBeUndefined();
    removeConfig(dir);
  });

  it('treats a broken or foreign config as absent and refuses to write a bad one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'debrief-config-'));
    writeFileSync(configFile(dir), '{');
    expect(readConfig(dir)).toBeUndefined();
    writeFileSync(configFile(dir), JSON.stringify({ apiUrl: 'ftp://x', key: KEY, keyId: 'k' }));
    expect(readConfig(dir)).toBeUndefined();
    expect(() => {
      writeConfig(dir, { apiUrl: 'http://x', key: 'nope', keyId: 'k' });
    }).toThrow();
  });
});
