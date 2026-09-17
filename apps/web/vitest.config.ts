import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'src/components/**/*.tsx', 'src/scenes/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/__fixtures__/**',
        'src/scenes/graph-canvas.tsx',
        'src/scenes/perf-probe.tsx',
        'src/scenes/theatre-probe.tsx',
        'src/scenes/blast-probe.tsx',
        'src/scenes/render-meter.tsx',
        'src/scenes/approach-canvas.tsx',
      ],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
