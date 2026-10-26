import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readConfig } from './config.js';
import { InstallError, install, uninstall } from './install.js';
import { hookCommand } from './settings.js';

const ROOT_KEY = `dbf_${'r'.repeat(43)}`;
const LOCAL_KEY = `dbf_${'l'.repeat(43)}`;

function api(trustOf: Record<string, 'local' | 'third-party'>) {
  const calls: string[] = [];
  const fetch = ((url: string, init: RequestInit) => {
    const key = new Headers(init.headers).get('authorization')!.slice('Bearer '.length);
    calls.push(`${init.method ?? 'GET'} ${new URL(url).pathname}`);
    const trust = trustOf[key];
    if (trust === undefined) return Promise.resolve(new Response('', { status: 401 }));
    if (url.endsWith('/v1/me'))
      return Promise.resolve(Response.json({ keyId: `id-${trust}`, tenantId: 't1', trust }));
    return Promise.resolve(
      Response.json({ id: 'id-issued', key: LOCAL_KEY, trust: 'local' }, { status: 201 }),
    );
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

function paths() {
  const root = mkdtempSync(join(tmpdir(), 'debrief-install-'));
  const configDir = join(root, 'debrief');
  const settingsFile = join(root, '.claude', 'settings.json');
  return {
    configDir,
    settingsFile,
    command: hookCommand('/n', '/b/debrief.js', configDir),
    host: 'laptop',
  };
}

describe('install', () => {
  it('turns a third-party key into a local one and never stores the third-party key', async () => {
    const p = paths();
    const { calls, fetch } = api({ [ROOT_KEY]: 'third-party' });
    const report = await install({ ...p, apiUrl: 'http://api.test', key: ROOT_KEY, fetch });
    expect(report).toEqual({ keyId: 'id-issued', issued: true });
    expect(calls).toEqual(['GET /v1/me', 'POST /v1/keys']);
    expect(readConfig(p.configDir)).toEqual({
      apiUrl: 'http://api.test',
      key: LOCAL_KEY,
      keyId: 'id-issued',
    });
    const everything = [
      readFileSync(p.settingsFile, 'utf8'),
      readFileSync(join(p.configDir, 'config.json'), 'utf8'),
    ];
    expect(everything.join()).not.toContain(ROOT_KEY);
    expect(readFileSync(p.settingsFile, 'utf8')).not.toContain(LOCAL_KEY);
  });

  it('keeps a local key, and reuses the stored key on a second install', async () => {
    const p = paths();
    const { calls, fetch } = api({ [LOCAL_KEY]: 'local' });
    expect(await install({ ...p, apiUrl: 'http://api.test', key: LOCAL_KEY, fetch })).toEqual({
      keyId: 'id-local',
      issued: false,
    });
    expect(await install({ ...p, apiUrl: 'http://api.test', fetch })).toMatchObject({
      issued: false,
    });
    expect(calls).toEqual(['GET /v1/me', 'GET /v1/me']);
    const settings = JSON.parse(readFileSync(p.settingsFile, 'utf8')) as {
      hooks: Record<string, unknown[]>;
    };
    expect(settings.hooks.Stop).toHaveLength(1);
    await expect(install({ ...p, apiUrl: 'http://other.test', fetch })).rejects.toThrow(
      InstallError,
    );
  });

  it('writes nothing when the key is missing or refused', async () => {
    const p = paths();
    const { fetch } = api({});
    await expect(install({ ...p, apiUrl: 'http://api.test', fetch })).rejects.toThrow(/pass --key/);
    await expect(
      install({ ...p, apiUrl: 'http://api.test', key: ROOT_KEY, fetch }),
    ).rejects.toThrow('the API refused the key (GET /v1/me answered 401)');
    expect(existsSync(p.settingsFile)).toBe(false);
    expect(readConfig(p.configDir)).toBeUndefined();
  });
});

describe('uninstall', () => {
  it('restores the settings and deletes the stored key', async () => {
    const p = paths();
    const { fetch } = api({ [LOCAL_KEY]: 'local' });
    await install({ ...p, apiUrl: 'http://api.test', key: LOCAL_KEY, fetch });
    expect(uninstall(p)).toEqual({ settings: 'restored', keyId: 'id-local' });
    expect(existsSync(p.settingsFile)).toBe(false);
    expect(readConfig(p.configDir)).toBeUndefined();
    writeFileSync(join(p.configDir, 'config.json'), '{}');
    expect(uninstall(p)).toEqual({ settings: 'absent' });
  });
});
