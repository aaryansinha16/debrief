#!/usr/bin/env node
import { register } from 'node:module';

register('@swc-node/register/esm', import.meta.url);
await import('../src/cli.ts');
