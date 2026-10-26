import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { vi } from 'vitest';

import { tempHomeEnv } from './src/home-guard.js';

// Captured before any mock runs: the real home is what the guard must keep tests out of.
const real = vi.hoisted(() => ({ env: { ...process.env }, home: process.env.HOME ?? '' }));

// Hoisted with the mocks: every fs flavour is wrapped, and the default dirs are guarded even when the real env relocates them.
const guard = vi.hoisted(
  () =>
    async <T extends object>(importOriginal: () => Promise<T>): Promise<T & { default: T }> => {
      const fs = await importOriginal();
      const { guardModule, guardedDirs } = await import('./src/home-guard.js');
      const guarded = [...guardedDirs(real.env, real.home), ...guardedDirs({}, real.home)];
      const patched = guardModule(fs, guarded);
      return { ...patched, default: patched };
    },
);

vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>();
  const patched = { ...os, homedir: () => process.env.HOME ?? os.homedir() };
  return { ...patched, default: patched };
});
vi.mock('node:fs', guard);
vi.mock('fs', guard);
vi.mock('node:fs/promises', guard);
vi.mock('fs/promises', guard);

process.env.DEBRIEF_REAL_HOME = real.home;
Object.assign(process.env, tempHomeEnv(mkdtempSync(join(tmpdir(), 'debrief-home-'))));
