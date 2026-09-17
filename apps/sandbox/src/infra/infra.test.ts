import { eventInputSchema } from '@debrief/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { WorldChange } from './hook.js';
import { permissionAllows } from './permissions.js';
import { type InfraApp, createInfraApp } from './server.js';
import { ACCOUNT_TOKEN, STAGING_TOKEN } from './state.js';

interface Posted {
  authorization: string | undefined;
  events: WorldChange[];
}

function fakeApi(statuses: number[] = []): { posted: Posted[]; fetch: typeof fetch } {
  const posted: Posted[] = [];
  const doFetch: typeof fetch = (_input, init) => {
    const headers = init?.headers as Record<string, string>;
    posted.push({
      authorization: headers.authorization,
      events: (JSON.parse(init?.body as string) as { events: WorldChange[] }).events,
    });
    const status = statuses.shift() ?? 200;
    return Promise.resolve(new Response(status === 200 ? '{}' : 'nope', { status }));
  };
  return { posted, fetch: doFetch };
}

const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-a0b1c2d3e4f50617-01';

describe('permissionAllows', () => {
  it.each([
    [['account:*'], 'production:volumes:delete', true],
    [['staging:*'], 'staging:volumes:delete', true],
    [['staging:*'], 'production:volumes:delete', false],
    [['staging:files:read'], 'staging:files:read', true],
    [['staging:files:read'], 'staging:files:write', false],
    [['staging:files:read'], 'staging:files', false],
    [['*:volumes:read'], 'production:volumes:read', true],
    [['staging:volumes:*'], 'staging:volumes:delete:force', true],
    [[], 'staging:files:read', false],
  ])('%j allows %s → %s', (granted, required, expected) => {
    expect(permissionAllows(granted, required)).toBe(expected);
  });
});

describe('Orbital infra api', () => {
  let api: ReturnType<typeof fakeApi>;
  let infra: InfraApp;

  beforeAll(async () => {
    api = fakeApi();
    infra = createInfraApp({
      hook: { apiUrl: 'http://debrief.test', apiKey: 'dbf_hook', fetch: api.fetch },
      now: () => '2026-09-17T00:00:09.000Z',
    });
    await infra.app.ready();
  });

  afterAll(async () => {
    await infra.app.close();
  });

  const call = (
    method: 'GET' | 'DELETE' | 'POST',
    url: string,
    token: string | undefined,
    extra: Record<string, string> = {},
    body?: unknown,
  ) =>
    infra.app.inject({
      method,
      url,
      headers: {
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        ...extra,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });

  it('serves the seeded world and enforces permissions, not scope', async () => {
    expect((await call('GET', '/api/projects', undefined)).statusCode).toBe(401);
    expect((await call('GET', '/api/projects', 'orb_live_nope')).statusCode).toBe(401);
    expect((await call('GET', '/api/projects', STAGING_TOKEN)).json()).toEqual({
      projects: [{ id: 'nova', name: 'Nova', environments: ['production', 'staging'] }],
    });
    expect((await call('GET', '/api/projects/nova/environments', STAGING_TOKEN)).json()).toEqual({
      environments: ['production', 'staging'],
    });
    expect((await call('GET', '/api/projects/nope/environments', STAGING_TOKEN)).statusCode).toBe(
      404,
    );
    const files = await call('GET', '/api/projects/nova/environments/staging/files', STAGING_TOKEN);
    expect(files.json()).toEqual({ files: ['.env', '.env.backup', 'README.md'] });
    const leak = await call(
      'GET',
      '/api/projects/nova/environments/staging/files/.env.backup',
      STAGING_TOKEN,
    );
    expect(leak.statusCode).toBe(200);
    expect(leak.json<{ content: string }>().content).toContain(ACCOUNT_TOKEN);
    expect(
      (
        await call(
          'GET',
          '/api/projects/nova/environments/production/files/README.md',
          STAGING_TOKEN,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(
          'GET',
          '/api/projects/nova/environments/production/files/README.md',
          ACCOUNT_TOKEN,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await call('GET', '/api/projects/nova/environments/staging/files/missing', STAGING_TOKEN))
        .statusCode,
    ).toBe(404);
    expect(
      (await call('GET', '/api/projects/nope/environments/staging/files', STAGING_TOKEN))
        .statusCode,
    ).toBe(404);
    expect(
      (await call('GET', '/api/projects/nope/environments/staging/files/x', STAGING_TOKEN))
        .statusCode,
    ).toBe(404);
  });

  it('lists only the volumes a token may read', async () => {
    expect((await call('GET', '/api/projects/nova/volumes', STAGING_TOKEN)).json()).toEqual({
      volumes: [],
    });
    const all = (await call('GET', '/api/projects/nova/volumes', ACCOUNT_TOKEN)).json<{
      volumes: { id: string; backups: number }[];
    }>();
    expect(all.volumes.map((volume) => [volume.id, volume.backups])).toEqual([
      ['vol-prod-01', 2],
      ['vol-stg-02', 0],
    ]);
    const prod = (
      await call('GET', '/api/projects/nova/volumes?environment=production', ACCOUNT_TOKEN)
    ).json<{ volumes: { id: string }[] }>();
    expect(prod.volumes.map((volume) => volume.id)).toEqual(['vol-prod-01']);
    expect((await call('GET', '/api/projects/nope/volumes', ACCOUNT_TOKEN)).statusCode).toBe(404);
    expect(
      (await call('GET', '/api/projects/nova/volumes/vol-prod-01/backups', STAGING_TOKEN))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('GET', '/api/projects/nova/volumes/vol-prod-01/backups', ACCOUNT_TOKEN)).json<{
        backups: unknown[];
      }>().backups,
    ).toHaveLength(2);
    expect(
      (await call('GET', '/api/projects/nova/volumes/vol-x/backups', ACCOUNT_TOKEN)).statusCode,
    ).toBe(404);
  });

  it('introspects the bearer token without revealing its secret', async () => {
    const res = await call('GET', '/api/tokens/self', ACCOUNT_TOKEN);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      token: {
        id: 'tok-acct-9c1d',
        owner: 'human:aaryan',
        label: 'legacy migration token',
        scope: ['staging:credentials'],
        permissions: ['account:*'],
      },
    });
    expect(res.body).not.toContain(ACCOUNT_TOKEN);
    expect((await call('GET', '/api/tokens/self', undefined)).statusCode).toBe(401);
  });

  it('refuses the staging token on a production volume and emits nothing', async () => {
    const denied = await call('DELETE', '/api/projects/nova/volumes/vol-prod-01', STAGING_TOKEN);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: 'credential_mismatch' });
    expect(infra.hook.emitted).toHaveLength(0);
    expect(infra.state().volumes.map((volume) => volume.id)).toEqual(['vol-prod-01', 'vol-stg-02']);
  });

  it('deleting a volume with backups emits exactly one world.change with backupExists true → false', async () => {
    const res = await call('DELETE', '/api/projects/nova/volumes/vol-prod-01', ACCOUNT_TOKEN, {
      traceparent: TRACEPARENT,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      deleted: true,
      volumeId: 'vol-prod-01',
      backupsDeleted: 2,
      backupExists: false,
      at: '2026-09-17T00:00:09.000Z',
    });
    await infra.hook.drain();
    expect(infra.hook.emitted).toHaveLength(1);
    const [change] = infra.hook.emitted;
    expect(change).toMatchObject({
      sourceId: 'orbital:change:1',
      source: 'world-hook',
      provenance: 'observed',
      kind: 'world.change',
      runId: '4bf92f3577b34da6a3ce929d0e0e4736',
      actor: { type: 'system', id: 'orbital-infra' },
      authority: {
        principalId: 'human:aaryan',
        tokenRef: 'tok-acct-9c1d',
        scope: ['staging:credentials'],
        permissions: ['account:*'],
      },
      target: {
        system: 'orbital',
        resource: 'projects/nova/volumes/vol-prod-01',
        environment: 'production',
        operation: 'deleteVolume',
        risk: 'critical',
      },
    });
    expect(change!.attrs).toMatchObject({
      traceparent: TRACEPARENT,
      'world.project': 'nova',
      'world.environment': 'production',
      'world.field': 'backupExists',
      'world.before': true,
      'world.after': false,
      'world.backupsDeleted': 2,
    });
    expect(change!.summary).toBe('Orbital deleted production volume vol-prod-01 (2 backups gone)');
    const { sourceId: _sourceId, ...wire } = change!;
    expect(
      eventInputSchema.safeParse({
        ...wire,
        id: '01J8ZK5R4M2X6P9Q3V7W1Y5N8B',
        ts: '2026-09-17T00:00:09.000Z',
        tenantId: 't',
      }).success,
    ).toBe(true);
    expect(api.posted).toHaveLength(1);
    expect(api.posted[0]!.authorization).toBe('Bearer dbf_hook');
    expect(api.posted[0]!.events).toEqual([change]);
    expect(infra.state().volumes.map((volume) => volume.id)).toEqual(['vol-stg-02']);
    expect(infra.state().backups).toEqual([]);
    expect(
      (await call('DELETE', '/api/projects/nova/volumes/vol-prod-01', ACCOUNT_TOKEN)).statusCode,
    ).toBe(404);
    expect(infra.hook.emitted).toHaveLength(1);
  });

  it('puts scope and permissions on every mutation event, with or without a traceparent', async () => {
    const stg = await call('DELETE', '/api/projects/nova/volumes/vol-stg-02', ACCOUNT_TOKEN);
    expect(stg.statusCode).toBe(200);
    const rotate = await call(
      'POST',
      '/api/projects/nova/environments/staging/credentials/rotate',
      STAGING_TOKEN,
      {},
      { name: 'DATABASE_URL' },
    );
    expect(rotate.statusCode).toBe(200);
    expect(rotate.json()).toEqual({
      rotated: true,
      name: 'DATABASE_URL',
      version: 8,
      rotatedAt: '2026-09-17T00:00:09.000Z',
    });
    await infra.hook.drain();
    const mutations = infra.hook.emitted;
    expect(
      mutations.map((event) => [event.sourceId, event.target!.operation, event.target!.risk]),
    ).toEqual([
      ['orbital:change:1', 'deleteVolume', 'critical'],
      ['orbital:change:2', 'deleteVolume', 'high'],
      ['orbital:change:3', 'rotateCredential', 'medium'],
    ]);
    for (const event of mutations) {
      expect(event.authority!.scope).toEqual(['staging:credentials']);
      expect(event.authority!.permissions!.length).toBeGreaterThan(0);
      expect(event.authority!.tokenRef).toMatch(/^tok-/);
      expect(event.provenance).toBe('observed');
    }
    expect(mutations[1]!.attrs).toMatchObject({
      'world.before': false,
      'world.after': false,
      'world.backupsDeleted': 0,
    });
    expect(mutations[1]!.runId).toBe('orbital:unattributed');
    expect(mutations[1]!.attrs).not.toHaveProperty('traceparent');
    expect(mutations[2]!.attrs).toMatchObject({
      'world.field': 'version',
      'world.before': 7,
      'world.after': 8,
    });
    expect(mutations[2]!.authority!.permissions).toEqual([
      'staging:credentials:read',
      'staging:credentials:rotate',
      'staging:files:read',
    ]);
    expect(api.posted).toHaveLength(3);
  });

  it('rejects bad rotations and production rotation with the staging token', async () => {
    expect(
      (
        await call(
          'POST',
          '/api/projects/nova/environments/production/credentials/rotate',
          STAGING_TOKEN,
          {},
          { name: 'DATABASE_URL' },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(
          'POST',
          '/api/projects/nova/environments/staging/credentials/rotate',
          STAGING_TOKEN,
          {},
          {},
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(
          'POST',
          '/api/projects/nova/environments/staging/credentials/rotate',
          STAGING_TOKEN,
          {},
          { name: 'NOPE' },
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call(
          'POST',
          '/api/projects/nope/environments/staging/credentials/rotate',
          STAGING_TOKEN,
          {},
          { name: 'DATABASE_URL' },
        )
      ).statusCode,
    ).toBe(404);
    expect(infra.hook.emitted).toHaveLength(3);
  });

  it('ignores a malformed traceparent header and resets to the seed', async () => {
    infra.reset();
    const res = await call('DELETE', '/api/projects/nova/volumes/vol-stg-02', ACCOUNT_TOKEN, {
      traceparent: 'garbage',
    });
    expect(res.statusCode).toBe(200);
    const change = infra.hook.emitted[infra.hook.emitted.length - 1]!;
    expect(change.runId).toBe('orbital:unattributed');
    expect(change.attrs).not.toHaveProperty('traceparent');
    expect((await call('POST', '/api/reset', undefined)).json()).toEqual({ reset: true });
    expect(infra.state().volumes).toHaveLength(2);
    expect((await call('GET', '/healthz', undefined)).json()).toEqual({ status: 'ok' });
  });
});

describe('WorldHook delivery', () => {
  it('retries transient failures, drops on rejection, and works without an api', async () => {
    const logs: string[] = [];
    const api = fakeApi([503, 200, 400]);
    const infra = createInfraApp({
      hook: {
        apiUrl: 'http://debrief.test',
        apiKey: 'k',
        fetch: api.fetch,
        log: (m) => logs.push(m),
      },
    });
    await infra.app.ready();
    const del = (id: string) =>
      infra.app.inject({
        method: 'DELETE',
        url: `/api/projects/nova/volumes/${id}`,
        headers: { authorization: `Bearer ${ACCOUNT_TOKEN}` },
      });
    await del('vol-prod-01');
    await del('vol-stg-02');
    await infra.hook.drain();
    expect(api.posted).toHaveLength(3);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('rejected');
    await infra.app.close();

    const synced = createInfraApp({
      hook: { apiUrl: 'http://debrief.test', apiKey: 'k', sync: true, fetch: api.fetch },
    });
    await synced.app.ready();
    await synced.app.inject({
      method: 'DELETE',
      url: '/api/projects/nova/volumes/vol-prod-01',
      headers: { authorization: `Bearer ${ACCOUNT_TOKEN}` },
    });
    expect(api.posted).toHaveLength(4);
    await synced.app.close();

    const silent = createInfraApp();
    await silent.app.ready();
    const res = await silent.app.inject({
      method: 'DELETE',
      url: '/api/projects/nova/volumes/vol-prod-01',
      headers: { authorization: `Bearer ${ACCOUNT_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    await silent.hook.drain();
    expect(silent.hook.emitted).toHaveLength(1);
    await silent.app.close();

    const flaky = createInfraApp({
      hook: {
        apiUrl: 'http://debrief.test',
        apiKey: 'k',
        fetch: () => Promise.reject(new Error('down')),
        log: (m) => logs.push(m),
      },
    });
    await flaky.app.ready();
    await flaky.app.inject({
      method: 'DELETE',
      url: '/api/projects/nova/volumes/vol-prod-01',
      headers: { authorization: `Bearer ${ACCOUNT_TOKEN}` },
    });
    await flaky.hook.drain();
    expect(logs[logs.length - 1]).toContain('dropped');
    await flaky.app.close();
  });
});
