import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readConfig, writeConfig } from './config.js';
import { install, uninstall } from './install.js';
import { hookCommand } from './settings.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const BIN = join(repoRoot, 'apps/cli/bin/debrief.js');
if (existsSync(join(repoRoot, '.env'))) process.loadEnvFile(join(repoRoot, '.env'));
const ready = ['DATABASE_URL', 'DATABASE_ADMIN_URL', 'S3_ENDPOINT', 'BLOB_MASTER_KEY'].every(
  (name) => process.env[name] !== undefined,
);

const GITHUB_TOKEN = `ghp_${'Q7xLm2'.repeat(6)}`;
const EMAIL = 'ana.lopez@corp.invalid';

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

async function waitFor(url: string): Promise<void> {
  for (const deadline = Date.now() + 30_000; Date.now() < deadline;) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`${url} did not come up`);
}

const entry = (uuid: string, type: 'user' | 'assistant', content: unknown): string =>
  `${JSON.stringify({ type, uuid, timestamp: '2026-10-26T09:15:02.123Z', message: { role: type, content } })}\n`;

describe.skipIf(!ready)('claude code capture end to end', () => {
  const tenant = `cli-e2e-${randomUUID().slice(0, 8)}`;
  let api: ChildProcess;
  let apiUrl = '';
  let rootKey = '';
  let sql: Sql;

  beforeAll(async () => {
    execFileSync('pnpm', ['--filter', '@debrief/api', 'db:migrate'], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    const seeded = execFileSync(
      'pnpm',
      ['--filter', '@debrief/api', '--silent', 'seed', '--tenant', tenant, '--capture', 'on'],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    rootKey = (JSON.parse(seeded.trim().split('\n').pop() ?? '{}') as { key: string }).key;
    const port = await freePort();
    apiUrl = `http://127.0.0.1:${String(port)}`;
    api = spawn(
      process.execPath,
      [
        '--env-file-if-exists=../../.env',
        '--import',
        '@swc-node/register/esm-register',
        'src/main.ts',
      ],
      {
        cwd: join(repoRoot, 'apps/api'),
        env: {
          ...process.env,
          API_PORT: String(port),
          LOG_LEVEL: 'warn',
          CHECKPOINT_INTERVAL_MS: '600000',
        },
        stdio: 'ignore',
      },
    );
    await waitFor(`${apiUrl}/readyz`);
    sql = postgres(process.env.DATABASE_ADMIN_URL!, { max: 1, onnotice: () => undefined });
  }, 120_000);

  afterAll(async () => {
    api.kill('SIGTERM');
    await sql.end();
  });

  it('stores a session once, redacted, with local git state, and catches up after the API was down', async () => {
    const root = mkdtempSync(join(tmpdir(), 'debrief-e2e-'));
    const configDir = join(root, 'debrief');
    const settingsFile = join(root, '.claude', 'settings.json');
    const repo = join(root, 'work');
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        [
          '-c',
          'user.name=t',
          '-c',
          'user.email=t@t.invalid',
          '-c',
          'commit.gpgsign=false',
          ...args,
        ],
        {
          cwd: repo,
          stdio: 'ignore',
        },
      );
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    writeFileSync(join(repo, 'app.ts'), 'export {};\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    const session = randomUUID();
    const transcript = join(root, `${session}.jsonl`);
    writeFileSync(
      transcript,
      entry(randomUUID(), 'user', `ship it and mail ${EMAIL}`) +
        entry(randomUUID(), 'assistant', [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'Bash',
            input: { command: `GH=${GITHUB_TOKEN} gh pr create` },
          },
        ]) +
        entry(randomUUID(), 'user', [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: `token ${GITHUB_TOKEN} accepted`,
          },
        ]) +
        entry(randomUUID(), 'assistant', [
          { type: 'text', text: 'Opened the PR; all tests pass.' },
        ]),
    );
    const input = {
      session_id: session,
      transcript_path: transcript,
      cwd: repo,
      hook_event_name: 'Stop',
    };
    const hook = (): Promise<{ code: number | null; ms: number }> =>
      new Promise((resolve) => {
        const started = performance.now();
        const child = spawn(process.execPath, [BIN, 'claude-code', 'hook', '--config', configDir], {
          cwd: repo,
          stdio: ['pipe', 'ignore', 'ignore'],
        });
        child.on('exit', (code) => {
          resolve({ code, ms: performance.now() - started });
        });
        child.stdin.end(JSON.stringify(input));
      });
    const stored = async () =>
      sql<{ kind: string; provenance: string; attrs: Record<string, unknown> }[]>`
        SELECT kind, provenance, attrs FROM events WHERE tenant_id = ${tenant} AND run_id = ${session} ORDER BY seq`;

    const report = await install({
      apiUrl,
      key: rootKey,
      configDir,
      settingsFile,
      command: hookCommand(process.execPath, BIN, configDir),
      host: 'e2e',
    });
    expect(report.issued).toBe(true);
    expect(readFileSync(settingsFile, 'utf8')).not.toContain('dbf_');

    expect((await hook()).code).toBe(0);
    const first = await stored();
    expect(first.map((row) => `${row.kind}/${row.provenance}`)).toEqual([
      'agent.message/reported',
      'tool.call/reported',
      'tool.result/reported',
      'agent.message/reported',
      'world.change/observed',
    ]);
    expect(first[4]!.attrs).toMatchObject({
      'witness.trust': 'local',
      'git.repo': 'work',
      'vcs.ref': 'refs/heads/main',
    });
    const dump = JSON.stringify(await sql`SELECT * FROM events WHERE tenant_id = ${tenant}`);
    expect(dump).not.toContain(GITHUB_TOKEN);
    expect(dump).not.toContain(EMAIL);

    await hook();
    rmSync(join(configDir, 'claude-code', 'sessions'), { recursive: true });
    await hook();
    expect(await stored()).toHaveLength(5);

    writeFileSync(join(repo, 'app.ts'), 'export const changed = 1;\n');
    await hook();
    expect((await stored()).map((row) => row.kind).slice(5)).toEqual(['world.change']);

    const config = readConfig(configDir)!;
    writeConfig(configDir, { ...config, apiUrl: `http://127.0.0.1:${String(await freePort())}` });
    appendFileSync(transcript, entry(randomUUID(), 'assistant', [{ type: 'text', text: 'Done.' }]));
    // Best of three: a shared CI runner's preemption is not the hook's cost.
    const down = [await hook(), await hook(), await hook()];
    expect(down.map((run) => run.code)).toEqual([0, 0, 0]);
    expect(Math.min(...down.map((run) => run.ms))).toBeLessThan(2000);
    expect(await stored()).toHaveLength(6);
    writeConfig(configDir, config);
    await hook();
    expect((await stored()).map((row) => row.kind).slice(6)).toEqual(['agent.message']);

    expect(uninstall({ configDir, settingsFile }).settings).toBe('restored');
    expect(existsSync(settingsFile)).toBe(false);
  });
});
