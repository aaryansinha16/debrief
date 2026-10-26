#!/usr/bin/env node
import { register } from 'node:module';
import { env } from 'node:process';
import { URL, fileURLToPath } from 'node:url';

// Claude Code runs the hook from the user's project, so the loader must not look for a tsconfig there.
env.SWC_NODE_PROJECT = fileURLToPath(new URL('../tsconfig.json', import.meta.url));
register('@swc-node/register/esm', import.meta.url);
await import('../src/cli.ts');
