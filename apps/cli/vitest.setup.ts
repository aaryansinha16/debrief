import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { vi } from 'vitest';

import { tempHomeEnv } from './src/home-guard.js';

// Captured before any mock runs: the real home is what the guard must keep tests out of.
const real = vi.hoisted(() => ({ env: { ...process.env }, home: process.env.HOME ?? '' }));

vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>();
  const patched = { ...os, homedir: () => process.env.HOME ?? os.homedir() };
  return { ...patched, default: patched };
});

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const { guardModule, guardedDirs } = await import('./src/home-guard.js');
  const patched = guardModule(fs, guardedDirs(real.env, real.home));
  return { ...patched, default: patched };
});

process.env.DEBRIEF_REAL_HOME = real.home;
Object.assign(process.env, tempHomeEnv(mkdtempSync(join(tmpdir(), 'debrief-home-'))));
