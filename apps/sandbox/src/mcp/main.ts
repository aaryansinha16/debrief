import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { STAGING_TOKEN } from '../infra/state.js';
import { OrbitalClient } from './orbital-client.js';
import { createOrbitalMcpServer } from './server.js';

const client = new OrbitalClient({
  baseUrl: process.env.ORBITAL_API_URL ?? `http://localhost:${process.env.SANDBOX_PORT ?? '4100'}`,
  defaultToken: process.env.ORBITAL_TOKEN ?? STAGING_TOKEN,
});
const server = createOrbitalMcpServer(client);
await server.connect(new StdioServerTransport());
