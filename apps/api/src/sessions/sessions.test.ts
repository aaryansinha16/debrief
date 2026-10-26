import { type Event, eventSchema } from '@debrief/schema';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { generateApiKey } from '../auth/api-keys.js';
import { runMigrations } from '../db/migrate.js';
import { EventsRepository } from '../events/events.repository.js';
import { ulid } from '../ids/ulid.js';
import { adminUrlFromEnv, createTempDatabase, type TempDatabase } from '../test/temp-db.js';
import type { SessionCheck } from './sessions.service.js';
import { SessionsService } from './sessions.service.js';

const adminUrl = adminUrlFromEnv();

const SESSION = '5d1c7a90-1b2e-4c3d-9e8f-0a1b2c3d4e5f';
const BASE = 'c0ffee5d1a2b3c4e5f60718293a4b5c6d7e8f901';
const HEAD = 'b7d4e90a1c2f3856a9e0d4c7b1f28a3e5d6c9f14';
const at = (time: string): string => `2026-10-25T${time}.000Z`;

const message = (n: number, time: string, text: string) => ({
  source: 'api',
  provenance: 'reported',
  kind: 'agent.message',
  runId: SESSION,
  sourceId: `${SESSION}:${String(n)}`,
  sourceTs: at(time),
  actor: { type: 'agent', id: 'claude-code' },
  attrs: {},
  summary: text,
});

const gitState = (sha: string, time: string, files: number) => ({
  source: 'world-hook',
  provenance: 'observed',
  kind: 'world.change',
  runId: SESSION,
  sourceId: `git:${SESSION}:${sha}:${time}`,
  sourceTs: at(time),
  actor: { type: 'system', id: 'debrief-git-witness' },
  target: { system: 'git', resource: 'billing-api', environment: 'dev', operation: 'git.state' },
  attrs: {
    'witness.trust': 'local',
    'git.repo': 'billing-api',
    'git.files': files,
    'commit.sha': sha,
    ...(files === 0 ? {} : { 'git.diffstat': '12\t3\tsrc/billing/invoice.ts' }),
  },
  summary: `billing-api at ${sha.slice(0, 7)}`,
});

const run = (time: string, attempt: number, conclusion: string, failed: number) => ({
  source: 'world-hook',
  provenance: 'observed',
  kind: 'world.change',
  runId: 'witness:github:2026-10-25',
  sourceId: `github:workflow_run:acme-demo/billing-api:4182:${String(attempt)}:${conclusion}`,
  sourceTs: at(time),
  actor: { type: 'human', id: 'alice-dev' },
  target: {
    system: 'github',
    resource: 'acme-demo/billing-api/actions/runs/4182',
    environment: 'unknown',
    operation: 'workflow_run.completed',
  },
  attrs: {
    'witness.trust': 'third-party',
    'github.run_id': 4182,
    'github.run_attempt': attempt,
    'ci.conclusion': conclusion,
    'commit.sha': HEAD,
    'github.workflow': 'ci',
    'ci.jobs.passed': 3 - failed,
    'ci.jobs.failed': failed,
  },
  summary: `workflow ci #4182 attempt ${String(attempt)} concluded ${conclusion}`,
});

const report = (
  time: string,
  attempt: number,
  passed: number,
  failed: number,
  skipped: number,
) => ({
  source: 'world-hook',
  provenance: 'observed',
  kind: 'world.change',
  runId: 'witness:github:2026-10-25',
  sourceId: `github:workflow_run_tests:acme-demo/billing-api:4182:${String(attempt)}:${String(passed)}.${String(failed)}.${String(skipped)}`,
  sourceTs: at(time),
  actor: { type: 'human', id: 'alice-dev' },
  target: {
    system: 'github',
    resource: 'acme-demo/billing-api/actions/runs/4182',
    environment: 'unknown',
    operation: 'workflow_run.tests',
  },
  attrs: {
    'witness.trust': 'third-party',
    'github.run_id': 4182,
    'github.run_attempt': attempt,
    'ci.conclusion': failed > 0 ? 'failure' : 'success',
    'commit.sha': HEAD,
    'github.workflow': 'ci',
    'github.workflow_path': '.github/workflows/ci.yml',
    'ci.tests.source': 'junit',
    'world.tests.passed': passed,
    'world.tests.failed': failed,
    'world.tests.skipped': skipped,
  },
  summary: `workflow ci #4182 tests: ${String(passed)} passed, ${String(failed)} failed, ${String(skipped)} skipped`,
});

describe.skipIf(adminUrl === undefined)('sessions', () => {
  let temp: TempDatabase;
  let admin: Sql;
  let app: NestFastifyApplication;
  const key = generateApiKey();
  let claimId = '';

  beforeAll(async () => {
    temp = await createTempDatabase(adminUrl!);
    await runMigrations({ adminUrl: temp.adminUrl, appRole: temp.role });
    admin = postgres(temp.adminUrl, { max: 1, onnotice: () => undefined });
    await admin.unsafe(`INSERT INTO tenants (id, name, capture_mode) VALUES ('t1', 'One', 'on')`);
    await admin.unsafe(
      `INSERT INTO api_keys (id, tenant_id, key_hash, prefix, name, trust) VALUES ('k1', 't1', '${key.keyHash}', '${key.prefix}', 'one', 'third-party')`,
    );
    process.env.DATABASE_URL = temp.appUrl;
    process.env.SESSION_SETTLE_MS = '60000';
    delete process.env.ANTHROPIC_API_KEY;
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await admin.end();
    await temp.drop();
    delete process.env.SESSION_SETTLE_MS;
    delete process.env.DATABASE_URL;
  });

  const inject = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
    (app.getHttpAdapter().getInstance() as FastifyInstance).inject({
      method,
      url,
      headers:
        payload === undefined
          ? { authorization: `Bearer ${key.key}` }
          : { authorization: `Bearer ${key.key}`, 'content-type': 'application/json' },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
  const post = (events: unknown[]) => inject('POST', '/v1/events', { events });

  it('lists a session once its messages arrive and checks it against the witnesses', async () => {
    expect((await inject('GET', '/v1/sessions')).json()).toEqual({ sessions: [] });
    const posted = await post([
      message(1, '09:00:00', 'Looking at the invoices bug.'),
      gitState(BASE, '09:00:05', 0),
      message(2, '09:12:00', 'All 142 tests pass.'),
      gitState(HEAD, '09:11:00', 1),
      run('09:13:00', 1, 'failure', 1),
      report('09:13:01', 1, 139, 3, 0),
    ]);
    expect(posted.statusCode).toBe(200);
    // The fixture session's claim, as extraction would have appended it (no model in this test).
    const [claim] = (
      await app.get(EventsRepository).append(
        't1',
        [
          {
            input: {
              id: ulid(),
              ts: at('09:12:30'),
              tenantId: 't1',
              source: 'api',
              provenance: 'derived',
              kind: 'claim',
              runId: SESSION,
              sourceTs: at('09:12:00'),
              actor: { type: 'system', id: 'debrief-claims' },
              target: { system: 'github' },
              attrs: {
                'claim.text': 'All 142 tests pass.',
                'claim.span.message_id': `${SESSION}:2`,
                'claim.span.start': 0,
                'claim.span.end': 19,
                'claim.modality': 'asserted',
                'claim.predicate': 'tests.passed',
                'claim.param.passed': 142,
              },
              summary: 'claim tests.passed (asserted)',
            },
          },
        ],
        'third-party',
      )
    ).events;
    claimId = claim!.id;

    const listed = (await inject('GET', '/v1/sessions')).json<{ sessions: unknown[] }>();
    expect(listed.sessions).toEqual([
      expect.objectContaining({ id: SESSION, messages: 2, claims: 1, verdicts: 0 }),
    ]);

    const read = (await inject('GET', `/v1/sessions/${SESSION}/check`)).json<SessionCheck>();
    expect(read.verdicts).toEqual([
      expect.objectContaining({
        claimId,
        outcome: 'contradicted',
        trust: 'third-party',
        checker: 'tests.passed@1',
      }),
    ]);
    expect(read.verdicts[0]?.eventId).toBeUndefined();
    expect(read.verdicts[0]?.evidence).toHaveLength(1);
    const reportRow = (await inject('GET', `/v1/runs/witness:github:2026-10-25/events`)).json<{
      events: { id: string; attrs: Record<string, unknown> }[];
    }>();
    expect(read.verdicts[0]?.evidence).toEqual([
      reportRow.events.find((e) => e.attrs['world.tests.passed'] === 139)?.id,
    ]);
    expect(read.claims).toEqual([
      expect.objectContaining({ id: claimId, predicate: 'tests.passed', params: { passed: 142 } }),
    ]);
    expect(read.appended).toBe(0);
    expect(read.witnesses).toEqual([
      { system: 'git', trust: 'local', events: 2 },
      { system: 'github', trust: 'third-party', events: 2 },
    ]);
    expect(read.session.window.from < at('09:00:00')).toBe(true);
    expect(read.session.window.to > at('09:13:01')).toBe(true);
  });

  it('appends the verdict when the session settles, once, as a valid event citing chain events', async () => {
    const racing = await Promise.all([
      inject('POST', `/v1/sessions/${SESSION}/check`),
      inject('POST', `/v1/sessions/${SESSION}/check`),
    ]);
    expect(racing.map((r) => r.json<SessionCheck>().appended).sort()).toEqual([0, 1]);
    await app.get(SessionsService).settle();
    const checked = (await inject('POST', `/v1/sessions/${SESSION}/check`)).json<SessionCheck>();
    expect(checked.appended).toBe(0);
    expect(checked.verdicts[0]?.eventId).toBeDefined();
    const repository = app.get(EventsRepository);
    const stored = (await repository.list('t1')).filter((e) => e.kind === 'verdict');
    expect(stored).toHaveLength(1);
    const [verdict] = stored;
    expect(eventSchema.safeParse(verdict).success).toBe(true);
    expect(verdict?.attrs['verdict.claim_id']).toBe(claimId);
    expect(verdict?.runId).toBe(SESSION);
    for (const id of String(verdict?.attrs['verdict.evidence']).split(',')) {
      const cited = await repository.findById('t1', id);
      expect(cited?.provenance).toBe('observed');
    }
    const listed = (await inject('GET', '/v1/sessions')).json<{
      sessions: { verdicts: number; checkedAt?: string }[];
    }>();
    expect(listed.sessions[0]).toMatchObject({ verdicts: 1, checkedAt: verdict?.ts });
  });

  it('re-checks when a witness lands in the window and appends a superseding verdict', async () => {
    const late = await post([run('09:20:00', 2, 'success', 0), report('09:20:01', 2, 142, 0, 0)]);
    expect(late.statusCode).toBe(200);
    await app.get(SessionsService).settle();
    const read = (await inject('GET', `/v1/sessions/${SESSION}/check`)).json<SessionCheck>();
    expect(read.verdicts).toEqual([
      expect.objectContaining({ outcome: 'holds', trust: 'third-party' }),
    ]);
    const stored = (await app.get(EventsRepository).list('t1')).filter(
      (e: Event) => e.kind === 'verdict',
    );
    expect(stored).toHaveLength(2);
    expect(stored[1]?.attrs['verdict.supersedes']).toBe(stored[0]?.id);
    expect(stored[1]?.attrs['verdict.outcome']).toBe('holds');
    expect(read.verdicts[0]?.eventId).toBe(stored[1]?.id);
    expect(read.sideEffects).toEqual({ effects: [], weak: [], covered: [] });
  });

  it('survives a witness event whose source time Postgres could not cast, and refuses reserved source ids', async () => {
    const poison = await post([
      {
        ...run('09:21:00', 3, 'success', 0),
        sourceId: 'github:poison',
        sourceTs: '2026-10-25T09:21:00+20:00',
      },
    ]);
    expect(poison.statusCode).toBe(200);
    await app.get(SessionsService).settle();
    const read = (await inject('GET', `/v1/sessions/${SESSION}/check`)).json<SessionCheck>();
    expect(read.verdicts[0]?.outcome).toBe('holds');
    const reserved = await post([{ ...message(9, '09:30:00', 'x'), sourceId: 'verdict:forged' }]);
    expect(reserved.statusCode).toBe(400);
    expect(reserved.json<{ message: string }>().message).toMatch(/verdict: and claim:/);
  });

  it('answers 404 for a run without messages and 400 for a bad limit', async () => {
    expect((await inject('GET', '/v1/sessions/witness:github:2026-10-25/check')).statusCode).toBe(
      404,
    );
    expect((await inject('POST', '/v1/sessions/nope/check')).statusCode).toBe(404);
    expect((await inject('GET', '/v1/sessions?limit=0')).statusCode).toBe(400);
  });
});
