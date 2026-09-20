import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Ed25519 and a hundred proofs per test take longer than five seconds under jsdom on the shared runner.
    testTimeout: 60_000,
    projects: [
      { extends: true, test: { name: 'node', environment: 'node' } },
      { extends: true, test: { name: 'jsdom', environment: 'jsdom' } },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__fixtures__/**'],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
