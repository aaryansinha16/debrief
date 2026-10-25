import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: 'node', environment: 'node' } },
      { extends: true, test: { name: 'jsdom', environment: 'jsdom' } },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__fixtures__/**'],
      thresholds: { lines: 95, branches: 85, functions: 95, statements: 95 },
    },
  },
});
