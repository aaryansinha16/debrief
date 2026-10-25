import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/cli.ts', 'src/index.ts'],
      thresholds: { lines: 90, branches: 75, functions: 90, statements: 90 },
    },
  },
});
