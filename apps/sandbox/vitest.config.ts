import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 60_000,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/test/**',
        'src/index.ts',
        'src/**/main.ts',
        'src/demo/nine-seconds.ts',
      ],
      thresholds: { lines: 90, branches: 85, functions: 90, statements: 90 },
    },
  },
});
