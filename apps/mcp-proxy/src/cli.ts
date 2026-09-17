import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { type Policy, PolicyParseError, parsePolicy } from '@debrief/policy';
import { captureModeSchema } from '@debrief/schema';

import { EventsEmitter } from './emitter.js';
import { startHttpProxy } from './http-proxy.js';
import { startProxy } from './proxy.js';

const USAGE =
  'usage: debrief-mcp-proxy --tenant-key <dbf_...> [--api <url>] [--capture off|summary|on] [--policy <file.yaml>] [--session <id>]\n' +
  '         -- <command> [args...]                 wrap a stdio server\n' +
  '         --upstream <url> [--listen <port>]     forward to a streamable-HTTP server\n' +
  '  --sync records each message before relaying it (deterministic ordering for demos)\n' +
  '  DEBRIEF_API_KEY and DEBRIEF_API_URL are read when the flags are absent\n';

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    api: { type: 'string', default: process.env.DEBRIEF_API_URL ?? 'http://localhost:4000' },
    'tenant-key': { type: 'string', default: process.env.DEBRIEF_API_KEY },
    key: { type: 'string' },
    capture: { type: 'string', default: 'on' },
    policy: { type: 'string' },
    session: { type: 'string' },
    sync: { type: 'boolean', default: false },
    upstream: { type: 'string' },
    listen: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});

const fail = (message: string): never => {
  process.stderr.write(`${message}\n${USAGE}`);
  process.exit(2);
};

if (values.help) {
  process.stderr.write(USAGE);
  process.exit(0);
}
const tenantKey = values.key ?? values['tenant-key'] ?? fail('a tenant key is required');
const capture = captureModeSchema.safeParse(values.capture);
if (!capture.success) fail(`--capture must be off, summary or on`);
let policy: Policy | undefined;
if (values.policy !== undefined) {
  try {
    policy = parsePolicy(readFileSync(values.policy, 'utf8'));
  } catch (error) {
    fail(
      error instanceof PolicyParseError
        ? `${values.policy}:\n${error.message}`
        : `cannot read ${values.policy}: ${String(error)}`,
    );
  }
}
if (values.upstream === undefined && positionals.length === 0)
  fail('give a command to wrap or --upstream');

const emitter = new EventsEmitter({
  apiUrl: values.api,
  apiKey: tenantKey,
  sync: values.sync,
  log: (message) => process.stderr.write(`${message}\n`),
});

if (values.upstream !== undefined) {
  const listen = values.listen === undefined ? undefined : Number(values.listen);
  const handle = await startHttpProxy({
    upstream: values.upstream,
    listen,
    emitter,
    capture: capture.data,
    policy,
    log: (message) => process.stderr.write(`${message}\n`),
  });
  process.stderr.write(`debrief-mcp-proxy: listening on ${handle.url} → ${values.upstream}\n`);
  const shutdown = (): void => {
    void handle
      .close()
      .then(() => emitter.drain())
      .then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} else {
  const [command, ...args] = positionals as [string, ...string[]];
  const handle = startProxy({
    command,
    args,
    emitter,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    sessionId: values.session,
    capture: capture.data,
    policy,
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      handle.child.kill(signal);
    });
  }
  process.exit(await handle.exited);
}
