import { parseArgs } from 'node:util';

import { EventsEmitter } from './emitter.js';
import { startProxy } from './proxy.js';

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    api: { type: 'string', default: process.env.DEBRIEF_API_URL ?? 'http://localhost:4000' },
    key: { type: 'string', default: process.env.DEBRIEF_API_KEY },
    session: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});

if (values.help || positionals.length === 0 || values.key === undefined) {
  process.stderr.write(
    'usage: debrief-mcp-proxy --key <dbf_...> [--api <url>] [--session <id>] -- <command> [args...]\n' +
      '  DEBRIEF_API_KEY and DEBRIEF_API_URL are read when the flags are absent\n',
  );
  process.exit(values.help ? 0 : 2);
}

const [command, ...args] = positionals as [string, ...string[]];
const emitter = new EventsEmitter({
  apiUrl: values.api,
  apiKey: values.key,
  log: (message) => process.stderr.write(`${message}\n`),
});
const handle = startProxy({
  command,
  args,
  emitter,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  sessionId: values.session,
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    handle.child.kill(signal);
  });
}
process.exit(await handle.exited);
