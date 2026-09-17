import { createInfraApp } from './server.js';

const port = Number(process.env.SANDBOX_PORT ?? 4100);
const apiKey = process.env.DEBRIEF_API_KEY;
const infra = createInfraApp({
  hook:
    apiKey === undefined
      ? undefined
      : {
          apiUrl: process.env.DEBRIEF_API_URL ?? 'http://localhost:4000',
          apiKey,
          log: (message) => process.stderr.write(`${message}\n`),
        },
});
if (apiKey === undefined)
  process.stderr.write('orbital: DEBRIEF_API_KEY unset, world changes are not emitted\n');
await infra.app.listen({ port, host: '0.0.0.0' });
process.stderr.write(`orbital: infra api listening on :${String(port)}\n`);
