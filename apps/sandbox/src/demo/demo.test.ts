import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const ready = ['DATABASE_URL', 'DATABASE_ADMIN_URL', 'S3_ENDPOINT', 'BLOB_MASTER_KEY'].every(
  (name) => process.env[name] !== undefined,
);

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

interface DemoOutput {
  apiKey: string;
  runId: string;
  events: number;
  proofVerified: boolean;
  verifyUrl: string;
  seconds: number;
}

describe.skipIf(!ready)('pnpm demo:nine-seconds', () => {
  it('completes in under 60 s with exit code 0 and at least 40 events', async () => {
    const [apiPort, infraPort] = [await freePort(), await freePort()];
    const started = performance.now();
    const { code, stdout, stderr } = await new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      execFile(
        'pnpm',
        [
          '--filter',
          '@debrief/sandbox',
          '--silent',
          'demo',
          '--no-compose',
          '--api-port',
          String(apiPort),
          '--infra-port',
          String(infraPort),
        ],
        { cwd: repoRoot, env: process.env, timeout: 90_000, encoding: 'utf8' },
        (error, out, err) => {
          resolve({
            code: error === null ? 0 : ((error as { code?: number }).code ?? 1),
            stdout: out,
            stderr: err,
          });
        },
      );
    });
    const elapsed = (performance.now() - started) / 1000;
    expect(code, stderr).toBe(0);
    expect(elapsed).toBeLessThan(60);
    const output = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as DemoOutput;
    expect(output.events).toBeGreaterThanOrEqual(40);
    expect(output.proofVerified).toBe(true);
    expect(output.runId).toMatch(/^[0-9a-f]{32}$/);
    expect(output.apiKey).toMatch(/^dbf_/);
    expect(output.verifyUrl).toContain(`:${String(apiPort)}/v1/proof?seq=`);
    expect(stderr).toContain('done in');
  }, 120_000);
});
