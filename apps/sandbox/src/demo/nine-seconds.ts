import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { runAgent } from '../agent/run.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../..');
const startedAt = performance.now();
const say = (message: string): void => {
  process.stderr.write(`[${((performance.now() - startedAt) / 1000).toFixed(1)}s] ${message}\n`);
};

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    compose: { type: 'boolean', default: true },
    'api-port': { type: 'string', default: '4000' },
    'infra-port': { type: 'string', default: process.env.SANDBOX_PORT ?? '4100' },
    tenant: { type: 'string' },
    live: { type: 'boolean', default: false },
  },
  allowNegative: true,
});

const apiPort = Number(values['api-port']);
const infraPort = Number(values['infra-port']);
const apiUrl = `http://127.0.0.1:${String(apiPort)}`;
const orbitalUrl = `http://127.0.0.1:${String(infraPort)}`;
const tenantId =
  values.tenant ??
  `demo-${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)}`;
const children: ChildProcess[] = [];

const stop = (): void => {
  for (const child of children) {
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 2000).unref();
  }
};

const NODE_LOADER = [
  '--env-file-if-exists=../../.env',
  '--import',
  '@swc-node/register/esm-register',
];

function service(
  label: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): ChildProcess {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    if (process.env.DEMO_VERBOSE === '1') process.stderr.write(`${label}: ${chunk}`);
  });
  children.push(child);
  return child;
}

async function waitFor(url: string, label: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`${label} did not come up at ${url}`);
}

async function poll<T>(
  label: string,
  fn: () => Promise<T | undefined>,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${label}`);
}

try {
  if (values.compose) {
    say('docker compose up -d --wait postgres minio');
    execFileSync('docker', ['compose', 'up', '-d', '--wait', 'postgres', 'minio'], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    execFileSync('docker', ['compose', 'up', '-d', 'minio-init'], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
  }
  say('applying migrations');
  execFileSync('pnpm', ['--filter', '@debrief/api', 'db:migrate'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });

  say(`seeding tenant ${tenantId}`);
  const seeded = JSON.parse(
    execFileSync(
      'pnpm',
      [
        '--filter',
        '@debrief/api',
        '--silent',
        'seed',
        '--tenant',
        tenantId,
        '--name',
        'Nine seconds demo',
        '--capture',
        'on',
        '--key-name',
        'demo',
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .pop() ?? '{}',
  ) as { key: string };

  say(`starting api on :${String(apiPort)}`);
  service(
    'api',
    process.execPath,
    [...NODE_LOADER, 'src/main.ts'],
    {
      ...process.env,
      API_PORT: String(apiPort),
      CHECKPOINT_INTERVAL_MS: '1000',
      LOG_LEVEL: 'warn',
    },
    join(repoRoot, 'apps/api'),
  );
  await waitFor(`${apiUrl}/readyz`, 'api');

  say(`starting orbital infra on :${String(infraPort)}`);
  service(
    'infra',
    process.execPath,
    [...NODE_LOADER, 'src/infra/main.ts'],
    {
      ...process.env,
      SANDBOX_PORT: String(infraPort),
      DEBRIEF_API_URL: apiUrl,
      DEBRIEF_API_KEY: seeded.key,
      ORBITAL_HOOK_SYNC: '1',
    },
    join(repoRoot, 'apps/sandbox'),
  );
  await waitFor(`${orbitalUrl}/healthz`, 'orbital infra');
  await fetch(`${orbitalUrl}/api/reset`, { method: 'POST' });

  say(`running the ${values.live ? 'live' : 'scripted'} agent`);
  const run = await runAgent({
    apiUrl,
    apiKey: seeded.key,
    orbitalUrl,
    live: values.live,
    log: (message) => {
      say(`agent: ${message}`);
    },
  });

  say('waiting for a signed checkpoint covering the run');
  const headers = { authorization: `Bearer ${seeded.key}` };
  let stable = 0;
  let last = -1;
  const checkpoint = await poll('checkpoint', async () => {
    const response = await fetch(`${apiUrl}/v1/checkpoints?limit=1`, { headers });
    const body = (await response.json()) as {
      checkpoints: { treeSize: number; rootHash: string; keyId: string }[];
    };
    const latest = body.checkpoints[0];
    if (latest === undefined) return undefined;
    stable = latest.treeSize === last ? stable + 1 : 0;
    last = latest.treeSize;
    return latest.treeSize >= 40 && stable >= 4 ? latest : undefined;
  });
  const proof = await fetch(`${apiUrl}/v1/proof?seq=${String(checkpoint.treeSize - 1)}`, {
    headers,
  });
  const events = checkpoint.treeSize;
  const elapsed = (performance.now() - startedAt) / 1000;
  process.stdout.write(
    `${JSON.stringify({
      tenantId,
      runId: run.runId,
      sessionId: run.sessionId,
      events,
      toolCalls: run.toolCalls,
      checkpoint: {
        treeSize: checkpoint.treeSize,
        rootHash: checkpoint.rootHash,
        keyId: checkpoint.keyId,
      },
      proofVerified: proof.ok,
      verifyUrl: `${apiUrl}/v1/proof?seq=${String(checkpoint.treeSize - 1)}`,
      keysUrl: `${apiUrl}/.well-known/debrief-keys.json`,
      seconds: Number(elapsed.toFixed(1)),
    })}\n`,
  );
  say(`done in ${elapsed.toFixed(1)}s: ${String(events)} events, run ${run.runId}`);
  if (events < 40 || !proof.ok) {
    say(`demo incomplete: events=${String(events)} proof=${String(proof.ok)}`);
    process.exitCode = 1;
  }
} catch (error) {
  say(`demo failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  stop();
  await new Promise((resolve) => setTimeout(resolve, 300));
  process.exit(process.exitCode ?? 0);
}
