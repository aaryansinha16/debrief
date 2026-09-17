import { parseArgs } from 'node:util';

import { runAgent } from './run.js';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    api: { type: 'string', default: process.env.DEBRIEF_API_URL ?? 'http://localhost:4000' },
    key: { type: 'string', default: process.env.DEBRIEF_API_KEY },
    orbital: {
      type: 'string',
      default:
        process.env.ORBITAL_API_URL ?? `http://localhost:${process.env.SANDBOX_PORT ?? '4100'}`,
    },
    policy: { type: 'string' },
    live: { type: 'boolean', default: false },
  },
});

if (values.key === undefined) {
  process.stderr.write(
    'usage: agent --key <dbf_...> [--api <url>] [--orbital <url>] [--policy <file>] [--live]\n',
  );
  process.exit(2);
}

const run = await runAgent({
  apiUrl: values.api,
  apiKey: values.key,
  orbitalUrl: values.orbital,
  live: values.live,
  policyFile: values.policy,
  log: (message) => process.stderr.write(`agent: ${message}\n`),
});
process.stdout.write(`${JSON.stringify(run)}\n`);
