import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 60_000,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/cli.ts', 'src/index.ts', 'src/home-guard.ts'],
      thresholds: { lines: 95, branches: 90, functions: 95, statements: 95 },
    },
  },
});
